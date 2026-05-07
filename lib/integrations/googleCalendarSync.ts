"use client";

import { buildGoogleAuthUrl, loadAuthSession } from "@/lib/auth/supabaseAuth";
import { readSnapshotServerFirst } from "@/lib/storage/serverRead";
import type { Session, Student, Teacher } from "@/lib/types/index";
import {
  buildBaseDatesISO,
  readMetaMap,
  computeEffectiveISO,
} from "@/lib/factories/sessionFactories";

function filterVisibleSessions(student: Student, sessions: Session[]): Session[] {
  void student;
  return sessions;
}

type SessionPatch = {
  id: string;
  patch: Partial<Session>;
};

type SyncArgs = {
  previous: Session[];
  next: Session[];
  applyPatches: (patches: SessionPatch[]) => void;
};

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
const DEFAULT_DURATION_MIN = 60;
const SYNC_DEBOUNCE_MS = 900;
const CREATE_PAST_GRACE_MS = 6 * 60 * 60 * 1000; // 6h
const DUPLICATE_TIME_WINDOW_MS = 5 * 60 * 1000;
const RECENT_CREATED_TTL_MS = 60 * 1000;
const APP_CALENDAR_SUMMARY = "옥진수학";
const APP_CALENDAR_DESCRIPTION = "옥진수학 자동 생성 수업 일정";
export const APP_EVENT_MARKER = "옥진수학 자동 생성 일정";
const STUDENT_MIRROR_MARKER = "학생용 보조 일정";
const CALENDAR_CACHE_TTL_MS = 30 * 60 * 1000; // [최적화] 5분 → 30분: 반복 캘린더 목록 조회 대폭 감소
const GOOGLE_AUTH_ERROR_DEDUP_MS = 15 * 1000;
const GOOGLE_AUTH_AUTO_REDIRECT_COOLDOWN_MS = 60 * 1000;
const GOOGLE_AUTH_AUTO_REDIRECT_KEY = "tutorweb_google_auth_auto_redirect_ts_v1";

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pending: SyncArgs | null = null;
let syncInFlight = false;
let googleAuthRedirecting = false;
const recentCreatedEventByOwnerSession = new Map<string, { eventId: string; ts: number }>();
const ownerCalendarIdCache = new Map<string, { calendarId: string; ts: number }>();
const recentGoogleAuthErrorAt = new Map<string, number>();

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeEmail(v: unknown): string {
  return text(v).toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
 
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function shouldNotifyGoogleAuthError(key: string): boolean {
  const now = Date.now();
  const last = recentGoogleAuthErrorAt.get(key) ?? 0;
  if (now - last < GOOGLE_AUTH_ERROR_DEDUP_MS) return false;
  recentGoogleAuthErrorAt.set(key, now);

  // 장시간 실행 탭에서 메모리 증가 방지
  if (recentGoogleAuthErrorAt.size > 80) {
    for (const [k, ts] of recentGoogleAuthErrorAt.entries()) {
      if (now - ts > GOOGLE_AUTH_ERROR_DEDUP_MS * 4) {
        recentGoogleAuthErrorAt.delete(k);
      }
    }
  }
  return true;
}

function canAutoRedirectGoogleAuth(): boolean {
  if (typeof window === "undefined") return false;
  if (googleAuthRedirecting) return false;
  if ((window.location.pathname ?? "").startsWith("/auth/callback")) return false;
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_AUTH_AUTO_REDIRECT_KEY) ?? "";
    const last = Number(raw);
    if (Number.isFinite(last) && last > 0) {
      if (Date.now() - last < GOOGLE_AUTH_AUTO_REDIRECT_COOLDOWN_MS) return false;
    }
  } catch {
    // sessionStorage 사용 불가 환경이면 쿨다운 없이 진행
  }
  return true;
}

async function tryAutoRecoverGoogleAuth401(): Promise<boolean> {
  if (!canAutoRedirectGoogleAuth()) return false;
  const nextPath = `${window.location.pathname}${window.location.search}`;
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath || "/")}`;
  const reconnectUrl = buildGoogleAuthUrl(redirectTo, true);
  if (!reconnectUrl) return false;

  try {
    window.sessionStorage.setItem(GOOGLE_AUTH_AUTO_REDIRECT_KEY, String(Date.now()));
  } catch {
    // no-op
  }
  googleAuthRedirecting = true;
  window.location.replace(reconnectUrl);
  return true;
}

function ownerSessionKey(ownerEmail: string, sessionId: string): string {
  return `${ownerEmail}::${sessionId}`;
}

function saveRecentCreatedEvent(args: { ownerEmail: string; sessionId: string; eventId: string }): void {
  if (!args.ownerEmail || !args.sessionId || !args.eventId) return;
  recentCreatedEventByOwnerSession.set(ownerSessionKey(args.ownerEmail, args.sessionId), {
    eventId: args.eventId,
    ts: Date.now(),
  });
}

function loadRecentCreatedEvent(args: { ownerEmail: string; sessionId: string }): string | null {
  if (!args.ownerEmail || !args.sessionId) return null;
  const key = ownerSessionKey(args.ownerEmail, args.sessionId);
  const row = recentCreatedEventByOwnerSession.get(key);
  if (!row) return null;
  if (Date.now() - row.ts > RECENT_CREATED_TTL_MS) {
    recentCreatedEventByOwnerSession.delete(key);
    return null;
  }
  return row.eventId;
}

function safeIso(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function addMinutes(iso: string, minutes: number): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString();
}

function collectAttendees(student: Student): Array<{ email: string }> {
  const out: Array<{ email: string }> = [];
  const used = new Set<string>();

  const push = (emailRaw: string | undefined) => {
    const email = text(emailRaw).toLowerCase();
    if (!email || !isValidEmail(email) || used.has(email)) return;
    used.add(email);
    out.push({ email });
  };

  push(student.googleEmail);
  return out;
}

function extractMeetUrl(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const hangoutLink = text(rec.hangoutLink);
  if (hangoutLink) return hangoutLink;

  const conferenceData =
    rec.conferenceData && typeof rec.conferenceData === "object"
      ? (rec.conferenceData as Record<string, unknown>)
      : null;
  const entryPoints = Array.isArray(conferenceData?.entryPoints)
    ? (conferenceData?.entryPoints as Array<Record<string, unknown>>)
    : [];
  for (const entry of entryPoints) {
    if (text(entry.entryPointType) !== "video") continue;
    const uri = text(entry.uri);
    if (uri) return uri;
  }

  return null;
}

function parseErrorText(body: unknown): string {
  if (!body || typeof body !== "object") return "Google Calendar API 오류";
  const rec = body as Record<string, unknown>;
  const error = rec.error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const e = error as Record<string, unknown>;
    const message = text(e.message);
    if (message) return message;
  }
  return "Google Calendar API 오류";
}

type CalendarListItem = {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
};

function parseCalendarListItems(body: unknown): { items: CalendarListItem[]; nextPageToken: string | null } {
  if (!body || typeof body !== "object") {
    return { items: [], nextPageToken: null };
  }
  const rec = body as Record<string, unknown>;
  const rows = Array.isArray(rec.items) ? rec.items : [];
  const items: CalendarListItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const id = text(entry.id);
    if (!id) continue;
    items.push({
      id,
      summary: text(entry.summary),
      accessRole: text(entry.accessRole),
      primary: Boolean(entry.primary),
    });
  }
  const nextPageToken = text(rec.nextPageToken) || null;
  return { items, nextPageToken };
}

async function findNamedCalendarId(args: { token: string; summary: string }): Promise<string | null> {
  let pageToken = "";
  for (let guard = 0; guard < 20; guard += 1) {
    const body = await requestGoogle({
      token: args.token,
      method: "GET",
      path: "/users/me/calendarList",
      query: {
        maxResults: "250",
        showHidden: "true",
        ...(pageToken ? { pageToken } : {}),
      },
    });
    const parsed = parseCalendarListItems(body);
    const matched = parsed.items.filter((item) => item.summary === args.summary);
    const preferred =
      matched.find((item) => item.accessRole === "owner") ??
      matched.find((item) => item.accessRole === "writer") ??
      matched[0];
    if (preferred?.id) return preferred.id;
    if (!parsed.nextPageToken) break;
    pageToken = parsed.nextPageToken;
  }
  return null;
}

async function createNamedCalendar(args: { token: string; summary: string }): Promise<string> {
  const body = await requestGoogle({
    token: args.token,
    method: "POST",
    path: "/calendars",
    body: {
      summary: args.summary,
      description: APP_CALENDAR_DESCRIPTION,
      timeZone: "Asia/Seoul",
    },
  });
  const id =
    body && typeof body === "object" ? text((body as Record<string, unknown>).id) : "";
  if (!id) throw new Error("캘린더 생성 후 id를 받지 못했습니다.");
  return id;
}

async function ensureAppCalendarId(args: {
  token: string;
  ownerEmail: string;
}): Promise<string> {
  const cacheKey = normalizeEmail(args.ownerEmail);
  const cached = ownerCalendarIdCache.get(cacheKey);
  if (cached && cached.calendarId !== "primary" && Date.now() - cached.ts < CALENDAR_CACHE_TTL_MS && cached.calendarId) {
    return cached.calendarId;
  }

  let foundId = "";
  try {
    foundId =
      (await findNamedCalendarId({
        token: args.token,
        summary: APP_CALENDAR_SUMMARY,
      })) ??
      (await createNamedCalendar({
        token: args.token,
        summary: APP_CALENDAR_SUMMARY,
      }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (isInsufficientScopeError(message)) {
      throw new Error("Google Calendar 권한에 전용 캘린더 생성 권한이 없습니다. 다시 로그인 후 권한을 다시 허용해주세요.");
    }
    throw err;
  }

  ownerCalendarIdCache.set(cacheKey, { calendarId: foundId, ts: Date.now() });
  return foundId;
}

export async function requestGoogle(args: {
  token: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  _retry?: boolean;
}): Promise<unknown> {
  const url = new URL(`${GOOGLE_CALENDAR_BASE_URL}${args.path}`);
  for (const [k, v] of Object.entries(args.query ?? {})) {
    url.searchParams.set(k, v);
  }
 
  const res = await fetch(url.toString(), {
    method: args.method,
    headers: {
      Authorization: `Bearer ${args.token}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined || args.method === "GET" ? undefined : JSON.stringify(args.body),
  });
 
  if (res.status === 204) return null;
 
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
 
  if (!res.ok) {
    const msg = parseErrorText(body);
    if (res.status === 401 && !args._retry) {
      // [보안] 게스트 계정(미등록 사용자)은 캘린더 리커버리를 시도하지 않음
      const { resolveUserRole } = await import("@/lib/auth/roleAuth");
      const auth = loadAuthSession();
      const userRole = await resolveUserRole({ email: auth?.email, accessToken: auth?.accessToken });
      if (userRole === "guest") {
        console.warn(`[Google API] 게스트 계정은 캘린더 접근 권한이 없습니다.`);
        throw new Error("미등록 계정은 이 기능을 사용할 수 없습니다. 원장님께 등록을 요청해 주세요.");
      }

      // 401 발생 시 토큰 만료 가능성이 있으므로 강제 갱신을 시도해봅니다.
      // 단, 현재 세션의 토큰이 요청에 사용된 토큰과 동일할 때만 갱신을 시도합니다.
      console.warn(`[Google API] 401 감지됨. 세션 갱신 시도 중... (${msg})`);
      try {
        const { forceRefreshAuthSession, loadAuthSession } = await import("@/lib/auth/supabaseAuth");
        const current = loadAuthSession();
        // 이미 다른 곳에서 갱신해서 토큰이 바뀌어 있다면, 굳이 또 갱신하지 않고 새 토큰으로 1회 리트라이
        if (current?.providerAccessToken && current.providerAccessToken !== args.token) {
          console.log("[Google API] 이미 토큰이 갱신되어 있습니다. 새 토큰으로 재시도합니다.");
          return requestGoogle({ ...args, token: current.providerAccessToken, _retry: true });
        }
        
        // 토큰이 그대로라면 실제 서버 갱신 시도
        const nextSession = await forceRefreshAuthSession();
        const nextToken = nextSession?.providerAccessToken;
        if (nextToken && nextToken !== args.token) {
          console.log("[Google API] 토큰 갱신 성공. 새 토큰으로 재시도합니다.");
          return requestGoogle({ ...args, token: nextToken, _retry: true });
        }
        console.warn("[Google API] 토큰 자동 갱신으로도 해결되지 않았습니다. (토큰 동일)");
      } catch (err) {
        console.error("[Google API Recovery Failed]", err);
      }
    }
 
    if (res.status === 401) {
      const tokenPrefix = args.token ? `${args.token.substring(0, 8)}...` : "NONE";
      const errorKey = `${args.method}:${args.path}:${msg}`;
      const shouldNotify = shouldNotifyGoogleAuthError(errorKey);
      if (shouldNotify) {
        console.error(`[Google API Persistent 401] Token: ${tokenPrefix}, Msg: ${msg}`);
      } else {
        console.warn(`[Google API Persistent 401: deduped] Token: ${tokenPrefix}, Msg: ${msg}`);
      }
      
      // 권한 재연결 유도를 위해 전역 이벤트를 발생시킵니다.
      let autoRedirected = false;
      if (typeof window !== "undefined") {
        if (shouldNotify) {
          const { TUTORWEB_EVENTS } = await import("@/lib/events/tutorwebEvents");
          window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.googleAuthError, { detail: { msg } }));
        }
        autoRedirected = await tryAutoRecoverGoogleAuth401();
      }

      const hint = autoRedirected
        ? "자동으로 구글 권한 재연결 화면으로 이동합니다."
        : "홈의 '구글 권한 다시 연결' 버튼을 눌러 다시 연결해주세요.";
      throw new Error(`401 구글 캘린더 권한이 만료되었거나 무효합니다. 사유: ${msg}. ${hint}`);
    }
    throw new Error(`${res.status} ${msg}`);
  }
 
  return body;
}

function isNotFoundError(message: string): boolean {
  return text(message).startsWith("404");
}

function clearOwnerCalendarCache(ownerEmail: string): void {
  const cacheKey = normalizeEmail(ownerEmail);
  if (!cacheKey) return;
  ownerCalendarIdCache.delete(cacheKey);
}

async function ensureAppCalendarIdWithRecovery(args: {
  token: string;
  ownerEmail: string;
}): Promise<string> {
  const firstId = await ensureAppCalendarId(args);
  try {
    await requestGoogle({
      token: args.token,
      method: "GET",
      path: `/calendars/${encodeURIComponent(firstId)}`,
    });
    return firstId;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (!isNotFoundError(message)) throw err;
    clearOwnerCalendarCache(args.ownerEmail);
    return ensureAppCalendarId(args);
  }
}

function sessionNeedsUpsert(previous: Session | undefined, next: Session): boolean {
  if (!next.googleCalendarEventId) return true;
  if (!previous) return true;
  return (
    previous.displayAt !== next.displayAt ||
    previous.index !== next.index ||
    previous.studentId !== next.studentId ||
    (previous.googleCalendarId ?? "") !== (next.googleCalendarId ?? "") ||
    (previous.googleCalendarEventId ?? "") !== (next.googleCalendarEventId ?? "") ||
    (previous.googleCalendarOwnerEmail ?? "") !== (next.googleCalendarOwnerEmail ?? "") ||
    (previous.googleCalendarStatus ?? "") !== (next.googleCalendarStatus ?? "") ||
    (previous.googleCalendarError ?? "") !== (next.googleCalendarError ?? "") ||
    (previous.title ?? "") !== (next.title ?? "") ||
    (previous.memo ?? "") !== (next.memo ?? "")
  );
}

function shouldCreateFor(next: Session): boolean {
  const iso = safeIso(next.displayAt);
  if (!iso) return false;
  return new Date(iso).getTime() >= Date.now() - CREATE_PAST_GRACE_MS;
}

function hasDisplayAtChanged(previous: Session | undefined, next: Session): boolean {
  if (!previous) return false;
  const prevIso = safeIso(previous.displayAt);
  const nextIso = safeIso(next.displayAt);
  if (prevIso && nextIso) return prevIso !== nextIso;
  return previous.displayAt !== next.displayAt;
}

function calendarIdOf(session: Session | undefined): string {
  return text(session?.googleCalendarId) || "primary";
}

function isPrimaryCalendarId(calendarId: string): boolean {
  return text(calendarId) === "primary";
}

function isPermissionOrNotFound(message: string): boolean {
  const msg = text(message);
  return msg.startsWith("403") || msg.startsWith("404");
}

function isInsufficientScopeError(message: string): boolean {
  const msg = text(message).toLowerCase();
  return (
    msg.includes("insufficient authentication scopes") ||
    msg.includes("insufficient permission") ||
    msg.includes("insufficientpermissions")
  );
}

type CandidateEvent = {
  eventId: string;
  meetUrl: string | null;
  startIso: string | null;
  summary: string;
  description: string;
  sessionId: string;
  studentId: string;
  attendeeEmails: string[];
  createdAtMs: number;
};

function parseCandidateEvents(body: unknown): CandidateEvent[] {
  if (!body || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  const items = Array.isArray(rec.items) ? rec.items : [];

  const out: CandidateEvent[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const eventId = text(row.id);
    if (!eventId) continue;
    const summary = text(row.summary);
    const description = text(row.description);
    const createdAtMs = Date.parse(text(row.created)) || 0;
    const startObj = row.start && typeof row.start === "object" ? (row.start as Record<string, unknown>) : null;
    const startIso = safeIso(text(startObj?.dateTime));
    const attendeesRaw = Array.isArray(row.attendees) ? row.attendees : [];
    const attendeeEmails: string[] = [];
    for (const attendee of attendeesRaw) {
      if (!attendee || typeof attendee !== "object") continue;
      const email = normalizeEmail((attendee as Record<string, unknown>).email);
      if (!email || attendeeEmails.includes(email)) continue;
      attendeeEmails.push(email);
    }
    const extendedProps =
      row.extendedProperties && typeof row.extendedProperties === "object"
        ? (row.extendedProperties as Record<string, unknown>)
        : null;
    const privateProps =
      extendedProps?.private && typeof extendedProps.private === "object"
        ? (extendedProps.private as Record<string, unknown>)
        : null;
    const sessionId = text(privateProps?.tutorweb_session_id);
    const studentId = text(privateProps?.tutorweb_student_id);
    out.push({
      eventId,
      meetUrl: extractMeetUrl(row),
      startIso,
      summary,
      description,
      sessionId,
      studentId,
      attendeeEmails,
      createdAtMs,
    });
  }
  return out;
}

function parseNextPageToken(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  return text((body as Record<string, unknown>).nextPageToken);
}

function isManagedStudentEvent(args: {
  event: CandidateEvent;
  studentId: string;
  studentName: string;
  studentEmail: string;
  teacherEmail: string;
}): boolean {
  const hasMarker = args.event.description.includes(APP_EVENT_MARKER);
  if (!hasMarker) return false;

  const studentId = text(args.studentId);
  const studentName = text(args.studentName);
  const studentEmail = normalizeEmail(args.studentEmail);
  const teacherEmail = normalizeEmail(args.teacherEmail);
  const attendeeSet = new Set(args.event.attendeeEmails.map((email) => normalizeEmail(email)));

  const hasStudentId = Boolean(studentId) && args.event.studentId === studentId;
  const hasStudentEmail = Boolean(studentEmail) && attendeeSet.has(studentEmail);
  const hasTeacherEmail = Boolean(teacherEmail) && attendeeSet.has(teacherEmail);
  const hasStudentName =
    Boolean(studentName) &&
    (args.event.summary.includes(studentName) || args.event.description.includes(`학생: ${studentName}`));

  if (hasStudentId || hasStudentEmail) return true;
  if (hasStudentName && (hasTeacherEmail || !teacherEmail)) return true;
  return false;
}

async function collectManagedEventsWithQuery(args: {
  token: string;
  calendarId: string;
  query: Record<string, string>;
  studentId: string;
  studentName: string;
  studentEmail: string;
  teacherEmail: string;
  out: Map<string, CandidateEvent>;
}): Promise<void> {
  let pageToken = "";
  for (let guard = 0; guard < 20; guard += 1) {
    const body = await requestGoogle({
      token: args.token,
      method: "GET",
      path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
      query: {
        singleEvents: "true",
        showDeleted: "false",
        maxResults: "250",
        ...args.query,
        ...(pageToken ? { pageToken } : {}),
      },
    });

    for (const event of parseCandidateEvents(body)) {
      if (
        isManagedStudentEvent({
          event,
          studentId: args.studentId,
          studentName: args.studentName,
          studentEmail: args.studentEmail,
          teacherEmail: args.teacherEmail,
        })
      ) {
        args.out.set(event.eventId, event);
      }
    }

    const nextPageToken = parseNextPageToken(body);
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
}

async function listManagedEventsByStudent(args: {
  token: string;
  calendarId: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  teacherEmail: string;
}): Promise<CandidateEvent[]> {
  const studentId = text(args.studentId);
  if (!studentId) return [];
  const studentName = text(args.studentName);
  const studentEmail = normalizeEmail(args.studentEmail);
  const teacherEmail = normalizeEmail(args.teacherEmail);
  const out = new Map<string, CandidateEvent>();

  await collectManagedEventsWithQuery({
    token: args.token,
    calendarId: args.calendarId,
    query: { privateExtendedProperty: `tutorweb_student_id=${studentId}` },
    studentId,
    studentName,
    studentEmail,
    teacherEmail,
    out,
  });

  // 과거 버전의 레거시 이벤트(extendedProperties 누락)도 같이 정리
  await collectManagedEventsWithQuery({
    token: args.token,
    calendarId: args.calendarId,
    query: { q: APP_EVENT_MARKER },
    studentId,
    studentName,
    studentEmail,
    teacherEmail,
    out,
  });

  return [...out.values()];
}

async function purgeManagedEventsForStudent(args: {
  token: string;
  calendarIds: string[];
  student: Pick<Student, "id" | "name" | "googleEmail">;
  teacherEmail?: string | null;
}): Promise<void> {
  const uniqueCalendarIds = Array.from(
    new Set((args.calendarIds ?? []).map((calendarId) => text(calendarId)).filter(Boolean))
  );

  for (const calendarId of uniqueCalendarIds) {
    try {
      const events = await listManagedEventsByStudent({
        token: args.token,
        calendarId,
        studentId: args.student.id,
        studentName: args.student.name,
        studentEmail: args.student.googleEmail,
        teacherEmail: args.teacherEmail ?? "",
      });
      for (const event of events) {
        try {
          await deleteEvent({
            token: args.token,
            calendarId,
            eventId: event.eventId,
            sendUpdates: "none",
          });
        } catch (err) {
          console.error("Google Calendar 앱 생성 일정 일괄 삭제 실패:", err);
        }
      }
    } catch (err) {
      console.error("Google Calendar 앱 생성 일정 조회 실패:", err);
    }
  }
}

async function findSessionEvents(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
  timeMin?: string;
  timeMax?: string;
}): Promise<CandidateEvent[]> {
  const query: Record<string, string> = {
    singleEvents: "true",
    showDeleted: "false",
    maxResults: "50",
    q: `${APP_EVENT_MARKER} ${args.student.name} ${args.session.index}회차`,
  };
  if (args.timeMin) query.timeMin = args.timeMin;
  if (args.timeMax) query.timeMax = args.timeMax;

  const body = await requestGoogle({
    token: args.token,
    method: "GET",
    path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
    query,
  });

  const all = parseCandidateEvents(body);
  return all.filter((event) => {
    const summary = event.summary;
    const description = event.description;
    const hasSessionId = event.sessionId === args.session.id;
    const hasAppMarker = description.includes(APP_EVENT_MARKER);
    const matchesStudent = summary.includes(args.student.name) || description.includes(`학생: ${args.student.name}`);
    const matchesIndex = summary.includes(`${args.session.index}회차`) || description.includes(`회차: ${args.session.index}`);
    return hasSessionId || (hasAppMarker && matchesStudent && matchesIndex);
  });
}

async function findSignatureEvents(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
}): Promise<CandidateEvent[]> {
  const startIso = safeIso(args.session.displayAt);
  if (!startIso) return [];

  const startMs = new Date(startIso).getTime();
  const timeMin = new Date(startMs - DUPLICATE_TIME_WINDOW_MS).toISOString();
  const timeMax = new Date(startMs + DUPLICATE_TIME_WINDOW_MS).toISOString();

  const body = await requestGoogle({
    token: args.token,
    method: "GET",
    path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
    query: {
      singleEvents: "true",
      showDeleted: "false",
      orderBy: "startTime",
      maxResults: "25",
      timeMin,
      timeMax,
    },
  });

  const all = parseCandidateEvents(body);
  return all
    .filter((event) => {
      if (!event.startIso) return false;
      const eventMs = new Date(event.startIso).getTime();
      return Math.abs(eventMs - startMs) <= DUPLICATE_TIME_WINDOW_MS;
    })
    .filter((event) => {
      const summary = event.summary;
      const description = event.description;
      const hasSessionId = event.sessionId === args.session.id;
      const hasAppMarker = description.includes(APP_EVENT_MARKER);
      const matchesStudent = summary.includes(args.student.name) || description.includes(`학생: ${args.student.name}`);
      const matchesIndex = summary.includes(`${args.session.index}회차`) || description.includes(`회차: ${args.session.index}`);
      return hasSessionId || (hasAppMarker && matchesStudent && matchesIndex);
    })
    .sort((a, b) => {
      const aMeet = a.meetUrl ? 1 : 0;
      const bMeet = b.meetUrl ? 1 : 0;
      if (aMeet !== bMeet) return bMeet - aMeet;
      return a.createdAtMs - b.createdAtMs;
    });
}

function buildEventPayload(args: {
  session: Session;
  student: Student;
  teacher: Teacher | null;
  includeMeetCreateRequest: boolean;
}): Record<string, unknown> | null {
  const startIso = safeIso(args.session.displayAt);
  if (!startIso) return null;

  const endIso = addMinutes(startIso, DEFAULT_DURATION_MIN);
  if (!endIso) return null;

  const summary = `${args.student.name} ${args.session.index}회차 수업`;
  const descriptionLines = [
    APP_EVENT_MARKER,
    `학생: ${args.student.name}`,
    args.teacher ? `선생님: ${args.teacher.name}` : "",
    `회차: ${args.session.index}`,
    args.session.memo ? `메모: ${args.session.memo}` : "",
  ].filter((line) => Boolean(line));

  const attendees = collectAttendees(args.student);

  const payload: Record<string, unknown> = {
    summary,
    description: descriptionLines.join("\n"),
    status: "confirmed",
    start: {
      dateTime: startIso,
      timeZone: "Asia/Seoul",
    },
    end: {
      dateTime: endIso,
      timeZone: "Asia/Seoul",
    },
    attendees,
    extendedProperties: {
      private: {
        tutorweb_session_id: args.session.id,
        tutorweb_student_id: args.student.id,
      },
    },
  };

  if (args.includeMeetCreateRequest) {
    payload.conferenceData = {
      createRequest: {
        requestId: `tutorweb-${args.session.id}-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return payload;
}

async function createEvent(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
  teacher: Teacher | null;
  sendUpdates?: "all" | "none";
}): Promise<{ eventId: string | null; meetUrl: string | null }> {
  const payload = buildEventPayload({
    session: args.session,
    student: args.student,
    teacher: args.teacher,
    includeMeetCreateRequest: true,
  });
  if (!payload) {
    return { eventId: null, meetUrl: null };
  }

  const body = await requestGoogle({
    token: args.token,
    method: "POST",
    path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
    query: {
      conferenceDataVersion: "1",
      sendUpdates: args.sendUpdates ?? "all",
    },
    body: payload,
  });

  const eventId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string)
      : null;
  const meetUrl = extractMeetUrl(body);
  return { eventId, meetUrl };
}

async function updateEvent(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
  teacher: Teacher | null;
}): Promise<{ eventId: string | null; meetUrl: string | null }> {
  const eventId = text(args.session.googleCalendarEventId);
  if (!eventId) return { eventId: null, meetUrl: null };

  const payload = buildEventPayload({
    session: args.session,
    student: args.student,
    teacher: args.teacher,
    includeMeetCreateRequest: !text(args.session.googleMeetUrl),
  });
  if (!payload) {
    return { eventId: null, meetUrl: null };
  }

  const body = await requestGoogle({
    token: args.token,
    method: "PATCH",
    path: `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(eventId)}`,
    query: {
      conferenceDataVersion: "1",
      sendUpdates: "all",
    },
    body: payload,
  });

  const nextEventId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string)
      : eventId;
  const fallbackMeet = text(args.session.googleMeetUrl);
  const meetUrl = extractMeetUrl(body) ?? (fallbackMeet || null);
  return { eventId: nextEventId, meetUrl };
}

async function deleteEvent(args: {
  token: string;
  calendarId: string;
  eventId: string;
  sendUpdates?: "all" | "none";
}): Promise<void> {
  const eventId = text(args.eventId);
  if (!eventId) return;

  try {
    await requestGoogle({
      token: args.token,
      method: "DELETE",
      path: `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(eventId)}`,
      query: {
        sendUpdates: args.sendUpdates ?? "all",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    // 이미 지워진 이벤트는 동기화 성공으로 취급
    if (msg.startsWith("404")) return;
    throw err;
  }
}

function buildStudentMirrorPayload(args: {
  session: Session;
  student: Student;
  teacher: Teacher | null;
}): Record<string, unknown> | null {
  const startIso = safeIso(args.session.displayAt);
  if (!startIso) return null;

  const endIso = addMinutes(startIso, DEFAULT_DURATION_MIN);
  if (!endIso) return null;

  const meetUrl = text(args.session.googleMeetUrl);
  const descriptionLines = [
    APP_EVENT_MARKER,
    STUDENT_MIRROR_MARKER,
    `학생: ${args.student.name}`,
    args.teacher ? `선생님: ${args.teacher.name}` : "",
    `회차: ${args.session.index}`,
    meetUrl ? `Meet 링크: ${meetUrl}` : "",
    args.session.memo ? `메모: ${args.session.memo}` : "",
  ].filter((line) => Boolean(line));

  return {
    summary: `${args.student.name} ${args.session.index}회차 수업`,
    description: descriptionLines.join("\n"),
    ...(meetUrl ? { location: meetUrl } : {}),
    start: {
      dateTime: startIso,
      timeZone: "Asia/Seoul",
    },
    end: {
      dateTime: endIso,
      timeZone: "Asia/Seoul",
    },
    extendedProperties: {
      private: {
        tutorweb_session_id: args.session.id,
        tutorweb_student_id: args.student.id,
        tutorweb_mirror_owner: "student",
      },
    },
  };
}

async function upsertStudentMirrorEvent(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
  teacher: Teacher | null;
}): Promise<void> {
  const payload = buildStudentMirrorPayload(args);
  if (!payload) return;

  const signatureEvents = await findSignatureEvents({
    token: args.token,
    calendarId: args.calendarId,
    session: args.session,
    student: args.student,
  });

  const canonical = signatureEvents[0] ?? null;
  const duplicates = signatureEvents.slice(1);
  for (const duplicate of duplicates) {
    try {
      await deleteEvent({
        token: args.token,
        calendarId: args.calendarId,
        eventId: duplicate.eventId,
        sendUpdates: "none",
      });
    } catch (err) {
      console.error("학생 캘린더 중복 이벤트 정리 실패:", err);
    }
  }

  if (canonical) {
    await requestGoogle({
      token: args.token,
      method: "PATCH",
      path: `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(canonical.eventId)}`,
      query: {
        sendUpdates: "none",
      },
      body: payload,
    });
  } else {
    await requestGoogle({
      token: args.token,
      method: "POST",
      path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
      query: {
        sendUpdates: "none",
      },
      body: payload,
    });
  }
}

async function runStudentMirrorSync(args: {
  studentIds: string[];
  sessions: Session[];
}): Promise<void> {
  void args;
  // 현재는 mirror 생성을 비활성화했지만, 복구 시 참고를 위해 함수 구현은 보존한다.
  void purgeManagedEventsForStudent;
  void upsertStudentMirrorEvent;
  // [26.03.10] 선생님의 메인 코어 이벤트가 자동 참석자 초대를 통해 단일 Event(Singluar Truth)로 기능하므로,
  // 강제로 학생 측 캘린더에 별도의 'Mirror(보조 일정)'을 생성하여 Google Meet 채널이 두 개로 갈라지는 증상을 방지하기 위해 로직을 무력화합니다.
  return;
}

export function syncStudentGoogleCalendarMirror(args: {
  studentIds: string[];
  sessions: Session[];
}): void {
  void runStudentMirrorSync(args);
}

async function runTeacherCalendarRebuild(args: {
  studentIds: string[];
  sessions: Session[];
  applyPatches: (patches: SessionPatch[]) => void;
}): Promise<void> {
  const auth = loadAuthSession();
  const providerToken = text(auth?.providerAccessToken);
  const currentEmail = normalizeEmail(auth?.email);
  if (!providerToken || !currentEmail) {
    return;
  }

  const targetStudentIds = new Set(
    (args.studentIds ?? []).map((id) => text(id)).filter(Boolean)
  );
  if (targetStudentIds.size === 0) return;

  const snapshot = await readSnapshotServerFirst();
  const students = snapshot.students;
  const teachers = snapshot.teachers;
  const studentById = new Map(students.map((student) => [student.id, student] as const));
  const teacherById = new Map(teachers.map((teacher) => [teacher.id, teacher] as const));
  const sessionsByStudent = new Map<string, Session[]>();
  const patches: SessionPatch[] = [];

  for (const session of args.sessions ?? []) {
    if (!targetStudentIds.has(session.studentId)) continue;
    const bucket = sessionsByStudent.get(session.studentId) ?? [];
    bucket.push(session);
    sessionsByStudent.set(session.studentId, bucket);
  }

  for (const [studentId, rows] of sessionsByStudent.entries()) {
    const student = studentById.get(studentId);
    if (!student) continue;
    const teacher = student.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const ownerEmail = normalizeEmail(teacher?.email);

    if (!teacher || !ownerEmail || !isValidEmail(ownerEmail)) {
      for (const session of rows) {
        patches.push({
          id: session.id,
          patch: {
            googleCalendarStatus: "error",
            googleCalendarError: "담당 선생님 이메일이 없어 캘린더를 다시 만들 수 없습니다.",
          },
        });
      }
      continue;
    }

    if (currentEmail !== ownerEmail) {
      for (const session of rows) {
        patches.push({
          id: session.id,
          patch: {
            googleCalendarStatus: "error",
            googleCalendarError: `담당 선생님 계정(${ownerEmail})으로 로그인한 뒤 다시 동기화해주세요.`,
          },
        });
      }
      continue;
    }

    try {
      const calendarId = await ensureAppCalendarIdWithRecovery({
        token: providerToken,
        ownerEmail,
      });

      // [중요] 일괄 삭제(purgeManagedEventsForStudent)는 401 에러나 타임아웃에 취약하고 누락 위험이 있습니다.
      // 대신 아래 개별 루프에서 findSessionEvents를 통해 확실하게 청소 및 입양을 진행합니다.

      const visibleRows = filterVisibleSessions(student, rows);
      const localMetaMap = readMetaMap(student.token);
      const baseDatesISOForStudent = buildBaseDatesISO(student, 120);

      const effectiveRows = visibleRows.map((s: Session) => {
        const { effectiveISO } = computeEffectiveISO({
          token: student.token,
          index: s.index,
          baseDatesISO: baseDatesISOForStudent,
          metaMap: localMetaMap,
        });
        return { ...s, displayAt: effectiveISO || s.displayAt };
      });

      const orderedSessions = [...effectiveRows].sort((a, b) => {
        const ta = new Date(a.displayAt).getTime();
        const tb = new Date(b.displayAt).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return a.index - b.index;
      });

      for (const session of orderedSessions) {
        try {
          // 1. 강제 청소 및 입양 (Purge & Adopt):
          // 현재 세션ID 또는 꼬리표(이름+회차) 기준 모든 일정을 뒤져서 유령을 청소합니다.
          const allSessionEvents = await findSessionEvents({
            token: providerToken,
            calendarId,
            session,
            student,
          });

          let sessionToCreateOrUpdate = { ...session };
          if (allSessionEvents.length > 0) {
            await delay(100);
            const currentStartMs = new Date(safeIso(session.displayAt) ?? 0).getTime();
            // 가장 가까운 시간을 찾거나, 없으면 첫 번째 일정을 입양(나중에 PATCH로 이동됨)
            const matchingCurrentTime = allSessionEvents.find(ev => {
              const evStartMs = new Date(ev.startIso ?? 0).getTime();
              return Math.abs(evStartMs - currentStartMs) <= DUPLICATE_TIME_WINDOW_MS;
            });
            const canonicalId = matchingCurrentTime?.eventId ?? allSessionEvents[0].eventId;
            const canonicalEvent = allSessionEvents.find(ev => ev.eventId === canonicalId);

            sessionToCreateOrUpdate = {
              ...sessionToCreateOrUpdate,
              googleCalendarEventId: canonicalId ?? undefined,
              googleMeetUrl: sessionToCreateOrUpdate.googleMeetUrl ?? canonicalEvent?.meetUrl ?? undefined,
            };

            // 기준 외의 모든 유령 삭제
            const duplicates = allSessionEvents.filter(ev => ev.eventId !== canonicalId);
            for (const dup of duplicates) {
              try {
                await deleteEvent({
                  token: providerToken,
                  calendarId,
                  eventId: dup.eventId,
                  sendUpdates: "none",
                });
              } catch (err) {
                console.warn(`[Rebuild-Purge] 유령 일정 삭제 실패: ${dup.eventId}`, err);
              }
            }
          }

          let result: { eventId: string | null; meetUrl: string | null };
          if (sessionToCreateOrUpdate.googleCalendarEventId) {
            result = await updateEvent({
              token: providerToken,
              calendarId,
              session: sessionToCreateOrUpdate,
              student,
              teacher,
            });
          } else {
            result = await createEvent({
              token: providerToken,
              calendarId,
              session: { ...sessionToCreateOrUpdate, googleCalendarEventId: undefined, googleMeetUrl: undefined },
              student,
              teacher,
              sendUpdates: "none",
            });
          }
          if (!result.eventId) {
            throw new Error("유효한 수업 시간이 없어 캘린더 일정을 만들지 못했습니다.");
          }
          patches.push({
            id: session.id,
            patch: {
              googleCalendarId: calendarId,
              googleCalendarEventId: result.eventId ?? undefined,
              googleMeetUrl: result.meetUrl ?? undefined,
              googleCalendarOwnerEmail: ownerEmail,
              googleCalendarStatus: "synced",
              googleCalendarError: "",
              googleCalendarSyncedAt: new Date().toISOString(),
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
          patches.push({
            id: session.id,
            patch: {
              googleCalendarId: calendarId,
              googleCalendarEventId: undefined,
              googleMeetUrl: undefined,
              googleCalendarOwnerEmail: ownerEmail,
              googleCalendarStatus: "error",
              googleCalendarError: message,
            },
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
      for (const session of rows) {
        patches.push({
          id: session.id,
          patch: {
            googleCalendarStatus: "error",
            googleCalendarError: message,
          },
        });
      }
    }
  }

  if (patches.length > 0) {
    args.applyPatches(patches);
  }
}

export function rebuildTeacherGoogleCalendar(args: {
  studentIds: string[];
  sessions: Session[];
  applyPatches: (patches: SessionPatch[]) => void;
}): void {
  void runTeacherCalendarRebuild(args);
}

async function runSync(args: SyncArgs): Promise<void> {
  const snapshot = await readSnapshotServerFirst();
  const students = snapshot.students;
  const studentById = new Map(students.map((s) => [s.id, s] as const));

  // 모든 세션에 대해 실시간 계산된 '진짜 날짜'를 먼저 입힙니다.
  const correctedNext = args.next.map((s) => {
    const student = studentById.get(s.studentId);
    if (!student) return s;
    // [성능] 각 세션마다 rebuild하는 대신 캐싱을 고려할 수 있으나, 일단 정확성을 위해 매번 계산
    const baseDatesISO = buildBaseDatesISO(student, 120);
    const localMetaMap = readMetaMap(student.token);
    const { effectiveISO } = computeEffectiveISO({
      token: student.token,
      index: s.index,
      baseDatesISO,
      metaMap: localMetaMap,
    });
    return { ...s, displayAt: effectiveISO || s.displayAt };
  });

  const previousById = new Map(args.previous.map((s) => [s.id, s] as const));
  const nextById = new Map(correctedNext.map((s) => [s.id, s] as const));
  const provisionalTargets = correctedNext.filter((next) => {
    const prev = previousById.get(next.id);
    const status = text(next.googleCalendarStatus);
    if (status === "pending" || status === "error") return true;
    if (!sessionNeedsUpsert(prev, next)) return false;
    if (!next.googleCalendarEventId && !shouldCreateFor(next)) return false;
    return true;
  });

  const applySyncErrorToTargets = (message: string) => {
    if (provisionalTargets.length === 0) return;
    args.applyPatches(
      provisionalTargets.map((session) => ({
        id: session.id,
        patch: {
          googleCalendarStatus: "error",
          googleCalendarError: message,
        },
      }))
    );
  };

  const auth = loadAuthSession();
  const providerToken = text(auth?.providerAccessToken);
  const currentEmail = normalizeEmail(auth?.email);
  if (!providerToken) {
    applySyncErrorToTargets("구글 캘린더 권한 토큰이 없습니다. 홈에서 구글 권한을 다시 연결해주세요.");
    return;
  }
  if (!currentEmail) {
    applySyncErrorToTargets("현재 로그인 이메일을 확인할 수 없습니다. 다시 로그인 해주세요.");
    return;
  }

  const teachers = snapshot.teachers;
  const teacherById = new Map(teachers.map((t) => [t.id, t] as const));
  const patches: SessionPatch[] = [];

  const { resolveUserRole } = await import("@/lib/auth/roleAuth");
  const userRole = await resolveUserRole({ email: auth?.email, accessToken: auth?.accessToken });
  if (userRole === "student") {
    console.log("[Calendar Sync] 학생 권한은 캘린더 동기화 기능을 사용하지 않습니다. (Phase 18 권한 격리)");
    return;
  }

  const visibleNextSessions: Session[] = [];
  for (const student of students) {
    const studentSessions = correctedNext.filter((s) => s.studentId === student.id);
    visibleNextSessions.push(...filterVisibleSessions(student, studentSessions));
  }
  const visibleSet = new Set(visibleNextSessions.map((s) => s.id));

  const targetSessions = visibleNextSessions.filter((next) => {
    const prev = previousById.get(next.id);
    const status = text(next.googleCalendarStatus);
    const statusDriven = status === "pending" || status === "error";
    const diffDriven = sessionNeedsUpsert(prev, next);

    const student = studentById.get(next.studentId);
    const teacher = student?.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const expectedOwnerEmail = normalizeEmail(teacher?.email);
    const savedOwnerEmail = normalizeEmail(next.googleCalendarOwnerEmail);
    const ownerDrift = Boolean(expectedOwnerEmail) && expectedOwnerEmail !== savedOwnerEmail;

    if (!statusDriven && !diffDriven && !ownerDrift) return false;
    if (!next.googleCalendarEventId && !shouldCreateFor(next) && !statusDriven && !ownerDrift) return false;
    return true;
  });

  for (const prev of args.previous) {
    if (visibleSet.has(prev.id)) continue;
    if (!prev.googleCalendarEventId) continue;
    const prevStudent = studentById.get(prev.studentId);
    const prevTeacher = prevStudent?.teacherId ? teacherById.get(prevStudent.teacherId) ?? null : null;
    const expectedOwnerEmail = normalizeEmail(prevTeacher?.email);
    if (!expectedOwnerEmail || expectedOwnerEmail !== currentEmail) continue;
    const prevCalendarId = calendarIdOf(prev);
    if (isPrimaryCalendarId(prevCalendarId)) continue;
    try {
      await deleteEvent({
        token: providerToken,
        calendarId: prevCalendarId,
        eventId: prev.googleCalendarEventId,
      });
      if (nextById.has(prev.id)) {
        patches.push({
          id: prev.id,
          patch: {
            googleCalendarId: undefined,
            googleCalendarEventId: undefined,
            googleMeetUrl: undefined,
            googleCalendarOwnerEmail: undefined,
            googleCalendarStatus: "synced",
            googleCalendarError: "",
          },
        });
      }
    } catch (err) {
      console.error("Google Calendar 이벤트 삭제 실패:", err);
    }
  }

  const orderedTargets = [...targetSessions].sort((a, b) => {
    const ta = new Date(a.displayAt).getTime();
    const tb = new Date(b.displayAt).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.index - b.index;
  });

  for (const next of orderedTargets) {
    const prev = previousById.get(next.id);
    const student = studentById.get(next.studentId);
    if (!student) {
      patches.push({
        id: next.id,
        patch: {
          googleCalendarStatus: "error",
          googleCalendarError: "학생 정보를 찾지 못해 캘린더 동기화가 중단되었습니다.",
        },
      });
      continue;
    }

    const teacher = student.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const teacherEmail = normalizeEmail(teacher?.email);
    const ownerEmail = teacherEmail;
    const savedOwnerEmail = normalizeEmail(next.googleCalendarOwnerEmail);
    const ownerMismatch = Boolean(savedOwnerEmail && savedOwnerEmail !== ownerEmail);
    const scheduleChanged = sessionNeedsUpsert(prev, next);

    if (!teacher || !ownerEmail || !isValidEmail(ownerEmail)) {
      patches.push({
        id: next.id,
        patch: {
          googleCalendarId: undefined,
          googleCalendarEventId: undefined,
          googleMeetUrl: undefined,
          googleCalendarOwnerEmail: undefined,
          googleCalendarStatus: "error",
          googleCalendarError: "담당 선생님 이메일이 없어서 Meet를 만들 수 없습니다. 관리자에게 문의해주세요.",
        },
      });
      continue;
    }

    if (ownerEmail !== currentEmail) {
      // 과거에 잘못된 소유자로 저장된 이벤트가 현재 로그인 계정 소유라면 정리
      if (ownerMismatch && savedOwnerEmail === currentEmail && next.googleCalendarEventId) {
        const nextCalendarId = calendarIdOf(next);
        if (!isPrimaryCalendarId(nextCalendarId)) {
          try {
            await deleteEvent({
              token: providerToken,
              calendarId: nextCalendarId,
              eventId: next.googleCalendarEventId,
            });
          } catch (err) {
            console.error("잘못된 소유자 이벤트 정리 실패:", err);
          }
        }
      }

      const hasReadyMeet =
        Boolean(text(next.googleCalendarEventId)) && Boolean(text(next.googleMeetUrl));
      const isSyncedStatus = text(next.googleCalendarStatus) === "synced";
      // 비소유자 계정에서도 "변경 없음 + 이미 동기화 완료"인 경우만 그대로 둡니다.
      // 일정이 바뀌었으면 반드시 pending으로 내려서 담당 선생님 재동기화를 유도합니다.
      if (!ownerMismatch && hasReadyMeet && isSyncedStatus && !scheduleChanged) {
        continue;
      }

      patches.push({
        id: next.id,
        patch: {
          googleCalendarOwnerEmail: ownerEmail,
          googleCalendarId: ownerMismatch ? undefined : next.googleCalendarId,
          googleCalendarEventId: ownerMismatch ? undefined : next.googleCalendarEventId,
          googleMeetUrl: ownerMismatch ? undefined : next.googleMeetUrl,
          googleCalendarStatus: "pending",
          googleCalendarError: "이 회차 Meet는 담당 선생님 계정으로 로그인해야 생성됩니다.",
        },
      });
      continue;
    }

    try {
      const targetCalendarId = await ensureAppCalendarIdWithRecovery({
        token: providerToken,
        ownerEmail,
      });

      let sessionForOwner: Session = ownerMismatch
        ? {
          ...next,
          googleCalendarId: targetCalendarId,
          googleCalendarEventId: undefined,
          googleMeetUrl: undefined,
        }
        : next;
      let sessionCalendarId = calendarIdOf(sessionForOwner);

      if (sessionCalendarId !== targetCalendarId) {
        const canCleanupCurrentCalendar = !isPrimaryCalendarId(sessionCalendarId);
        // 캘린더 이동(primary -> 앱 전용) 시, 이전 캘린더에 남아있는 같은 회차 이벤트를 먼저 정리
        let cleanedBySignature = false;
        if (canCleanupCurrentCalendar) {
          try {
            const staleEvents = await findSignatureEvents({
              token: providerToken,
              calendarId: sessionCalendarId,
              session: sessionForOwner,
              student,
            });
            if (staleEvents.length > 0) {
              cleanedBySignature = true;
            }
            for (const stale of staleEvents) {
              try {
                await deleteEvent({
                  token: providerToken,
                  calendarId: sessionCalendarId,
                  eventId: stale.eventId,
                  sendUpdates: "none",
                });
              } catch (err) {
                console.error("Google Calendar 캘린더 이동 중 이전 캘린더 이벤트 정리 실패:", err);
              }
            }
          } catch (err) {
            console.error("Google Calendar 캘린더 이동 중 이전 캘린더 이벤트 조회 실패:", err);
          }
        }

        if (canCleanupCurrentCalendar && !cleanedBySignature && sessionForOwner.googleCalendarEventId) {
          try {
            await deleteEvent({
              token: providerToken,
              calendarId: sessionCalendarId,
              eventId: sessionForOwner.googleCalendarEventId,
              sendUpdates: "none",
            });
          } catch (err) {
            console.error("Google Calendar 캘린더 이동 중 기존 이벤트 삭제 실패:", err);
          }
        }
        sessionForOwner = {
          ...sessionForOwner,
          googleCalendarId: targetCalendarId,
          googleCalendarEventId: undefined,
          googleMeetUrl: undefined,
        };
        sessionCalendarId = targetCalendarId;
      }

      // 시간표 변경 등으로 회차 시간이 바뀐 경우:
      // 과거에는 여기서 강제로 deleteEvent() 호출 및 eventId를 undefined로 리셋했으나,
      // 이제는 삭제하지 않고 뒤쪽의 updateEvent가 해당 eventId를 그대로 호출해 새 시간대로 PATCH 이동시키도록 유도함.
      if (prev && hasDisplayAtChanged(prev, next)) {
        // 단지 로깅만 남기고 진행 (기존 eventId 보존)
        console.log(`[Google Calendar] 일정 변경 감지됨: ${student.name} ${next.index}회차. PATCH 이동 처리 예정.`);
      }

      if (!sessionForOwner.googleCalendarEventId) {
        const recentEventId = loadRecentCreatedEvent({
          ownerEmail,
          sessionId: sessionForOwner.id,
        });
        if (recentEventId) {
          sessionForOwner = {
            ...sessionForOwner,
            googleCalendarEventId: recentEventId,
          };
        }
      }

      // 1. 강제 청소 및 입양 (Purge & Adopt): 
      // 현재 세션 ID 또는 시그니처(이름+회차)를 가진 모든 일정을 찾습니다. (시간 창에 구애받지 않음)
      const allSessionEvents = await findSessionEvents({
        token: providerToken,
        calendarId: sessionCalendarId,
        session: sessionForOwner,
        student,
      });

      if (allSessionEvents.length > 0) {
        await delay(100);
        const currentStartMs = new Date(safeIso(sessionForOwner.displayAt) ?? 0).getTime();

        // 1-1. 기준(Canonical) 일정 선정
        // - 이미 세션에 기록된 eventId가 있다면 그것을 최우선으로 사용
        // - 없다면, 현재 시간(new date)에 가장 근접한(±5분) 일정을 입양
        // - 그것도 없다면, 그냥 발견된 첫 번째 일정을 입양 (나중에 PATCH로 새 시간에 옮길 것임)
        let canonicalId = sessionForOwner.googleCalendarEventId;
        const matchingCurrentTime = allSessionEvents.find(ev => {
          const evStartMs = new Date(ev.startIso ?? 0).getTime();
          return Math.abs(evStartMs - currentStartMs) <= DUPLICATE_TIME_WINDOW_MS;
        });

        if (!canonicalId) {
          canonicalId = matchingCurrentTime?.eventId ?? allSessionEvents[0].eventId;
          const canonicalEvent = allSessionEvents.find(ev => ev.eventId === canonicalId);
          sessionForOwner = {
            ...sessionForOwner,
            googleCalendarEventId: canonicalId ?? undefined,
            googleMeetUrl: sessionForOwner.googleMeetUrl ?? canonicalEvent?.meetUrl ?? undefined,
          };
        }

        // 1-2. 기준 이외의 모든 유령/중복 일정 청소
        const duplicates = allSessionEvents.filter(ev => ev.eventId !== canonicalId);
        for (const dup of duplicates) {
          try {
            await deleteEvent({
              token: providerToken,
              calendarId: sessionCalendarId,
              eventId: dup.eventId,
              sendUpdates: "none",
            });
            console.log(`[Purge] 중복/유령 일정 삭제 성공: ${student.name} ${next.index}회차 (${dup.startIso})`);
          } catch (err) {
            console.error(`[Purge] 중복/유령 일정 삭제 실패: ${dup.eventId}`, err);
          }
        }
      }

      let result: { eventId: string | null; meetUrl: string | null };
      if (sessionForOwner.googleCalendarEventId) {
        try {
          result = await updateEvent({
            token: providerToken,
            calendarId: sessionCalendarId,
            session: sessionForOwner,
            student,
            teacher,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
          if (isPermissionOrNotFound(message)) {
            // 과거 다른 계정에서 만든 eventId 또는 권한 변경으로 접근 불가면 새 이벤트로 복구
            result = await createEvent({
              token: providerToken,
              calendarId: sessionCalendarId,
              session: { ...sessionForOwner, googleCalendarEventId: undefined, googleMeetUrl: undefined },
              student,
              teacher,
            });
          } else {
            throw err;
          }
        }
      } else {
        result = await createEvent({
          token: providerToken,
          calendarId: sessionCalendarId,
          session: sessionForOwner,
          student,
          teacher,
        });
        if (result.eventId) {
          saveRecentCreatedEvent({
            ownerEmail,
            sessionId: sessionForOwner.id,
            eventId: result.eventId,
          });
        }
      }

      if (!result.eventId) {
        throw new Error("유효한 수업 시간이 없어 캘린더 일정을 만들지 못했습니다.");
      }

      // 같은 회차가 target 캘린더 외의 앱 캘린더에 남아 있으면 정리
      const staleCalendarIds = new Set<string>();
      staleCalendarIds.add(calendarIdOf(prev));
      staleCalendarIds.add(calendarIdOf(next));
      staleCalendarIds.delete("");
      staleCalendarIds.delete("primary");
      staleCalendarIds.delete(sessionCalendarId);
      for (const staleCalendarId of staleCalendarIds) {
        try {
          const staleEvents = await findSignatureEvents({
            token: providerToken,
            calendarId: staleCalendarId,
            session: sessionForOwner,
            student,
          });
          for (const stale of staleEvents) {
            try {
              await deleteEvent({
                token: providerToken,
                calendarId: staleCalendarId,
                eventId: stale.eventId,
                sendUpdates: "none",
              });
            } catch (err) {
              console.error("Google Calendar 비대상 캘린더 중복 정리 실패:", err);
            }
          }
        } catch (err) {
          console.error("Google Calendar 비대상 캘린더 중복 조회 실패:", err);
        }
      }

      patches.push({
        id: next.id,
        patch: {
          googleCalendarId: sessionCalendarId,
          googleCalendarEventId: result.eventId ?? undefined,
          googleMeetUrl: result.meetUrl ?? undefined,
          googleCalendarOwnerEmail: ownerEmail,
          googleCalendarStatus: "synced",
          googleCalendarError: "",
          googleCalendarSyncedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google Calendar 동기화 실패";
      patches.push({
        id: next.id,
        patch: {
          googleCalendarStatus: "error",
          googleCalendarError: message,
        },
      });
    }
  }

  if (patches.length > 0) {
    args.applyPatches(patches);
  }
}

async function flushPending(): Promise<void> {
  if (syncInFlight) return;
  if (!pending) return;

  syncInFlight = true;
  try {
    while (pending) {
      const job = pending;
      pending = null;
      await runSync(job);
    }
  } finally {
    syncInFlight = false;
  }
}

export function scheduleGoogleCalendarSync(args: SyncArgs): void {
  if (pending) {
    pending = {
      previous: pending.previous,
      next: args.next,
      applyPatches: args.applyPatches,
    };
  } else {
    pending = args;
  }

  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    void flushPending();
  }, SYNC_DEBOUNCE_MS);
}
