"use client";

import { loadAuthSession } from "@/lib/auth/supabaseAuth";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers } from "@/lib/storage/teachers";
import type { Session, Student, Teacher } from "@/lib/types/index";
import {
  buildBaseDatesISOByToken,
  readMetaMap,
  getSessionVisibility,
} from "@/lib/factories/sessionFactories";
import { findLastClassIndex } from "@/lib/ui/session/pauseHelpers";

function filterVisibleSessions(student: Student, sessions: Session[]): Session[] {
  if (
    (student.pauseStatus !== "confirmed" && student.pauseStatus !== "paused") ||
    !student.pauseEffectiveDate ||
    !student.token
  ) {
    return sessions;
  }

  const baseDatesISO = buildBaseDatesISOByToken(student.token, 60);
  const metaMap = readMetaMap(student.token);

  const lastClassIndex = findLastClassIndex({
    token: student.token,
    sessions,
    baseDatesISO,
    metaMap,
    pauseEffectiveDate: student.pauseEffectiveDate,
  });

  if (lastClassIndex === null) return sessions;

  return sessions.filter(s => {
    const visibility = getSessionVisibility({ index: s.index, lastVisibleIndex: lastClassIndex });
    return visibility !== "hidden";
  });
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
const APP_EVENT_MARKER = "옥진수학 자동 생성 일정";
const STUDENT_MIRROR_MARKER = "학생용 보조 일정";
const CALENDAR_CACHE_TTL_MS = 30 * 60 * 1000; // [최적화] 5분 → 30분: 반복 캘린더 목록 조회 대폭 감소

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pending: SyncArgs | null = null;
let syncInFlight = false;
const recentCreatedEventByOwnerSession = new Map<string, { eventId: string; ts: number }>();
const ownerCalendarIdCache = new Map<string, { calendarId: string; ts: number }>();

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeEmail(v: unknown): string {
  return text(v).toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

async function requestGoogle(args: {
  token: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
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
    if (res.status === 401) {
      throw new Error("401 구글 캘린더 권한이 만료되었거나 무효합니다. 홈에서 로그아웃 후 다시 로그인해주세요.");
    }
    const msg = parseErrorText(body);
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

  const students = loadStudents();
  const teachers = loadTeachers();
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
      await purgeManagedEventsForStudent({
        token: providerToken,
        calendarIds: [calendarId],
        student,
        teacherEmail: ownerEmail,
      });

      const visibleRows = filterVisibleSessions(student, rows);
      const orderedSessions = [...visibleRows].sort((a, b) => {
        const ta = new Date(a.displayAt).getTime();
        const tb = new Date(b.displayAt).getTime();
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return a.index - b.index;
      });

      for (const session of orderedSessions) {
        try {
          const result = await createEvent({
            token: providerToken,
            calendarId,
            session: { ...session, googleCalendarEventId: undefined, googleMeetUrl: undefined },
            student,
            teacher,
            sendUpdates: "none",
          });
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
  const previousById = new Map(args.previous.map((s) => [s.id, s] as const));
  const nextById = new Map(args.next.map((s) => [s.id, s] as const));
  const provisionalTargets = args.next.filter((next) => {
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
    applySyncErrorToTargets("구글 캘린더 권한 토큰이 없습니다. 로그아웃 후 다시 로그인 해주세요.");
    return;
  }
  if (!currentEmail) {
    applySyncErrorToTargets("현재 로그인 이메일을 확인할 수 없습니다. 다시 로그인 해주세요.");
    return;
  }

  const students = loadStudents();
  const teachers = loadTeachers();
  const studentById = new Map(students.map((s) => [s.id, s] as const));
  const teacherById = new Map(teachers.map((t) => [t.id, t] as const));
  const patches: SessionPatch[] = [];

  // 학생 계정으로 로그인해도 "옥진수학" 전용 캘린더가 자동으로 생성되도록 보장
  const isStudentAccount = students.some(
    (student) => normalizeEmail(student.googleEmail) === currentEmail
  );
  if (isStudentAccount) {
    try {
      await ensureAppCalendarIdWithRecovery({
        token: providerToken,
        ownerEmail: currentEmail,
      });
    } catch (err) {
      console.error("학생 계정 전용 캘린더 준비 실패:", err);
    }
  }

  const visibleNextSessions: Session[] = [];
  for (const student of students) {
    const studentSessions = args.next.filter(s => s.studentId === student.id);
    visibleNextSessions.push(...filterVisibleSessions(student, studentSessions));
  }
  const visibleSet = new Set(visibleNextSessions.map(s => s.id));

  // 이메일 변경처럼 "세션 행 자체는 안 바뀌었지만 소유자가 달라진 경우"를 포함해서 동기화 대상 선정
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
      // 학생 로그인 등 비소유자 계정에서는 이미 완성된 회차 상태를 pending으로 덮어쓰지 않는다.
      if (!ownerMismatch && hasReadyMeet) {
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

      const signatureEvents = await findSignatureEvents({
        token: providerToken,
        calendarId: sessionCalendarId,
        session: sessionForOwner,
        student,
      });
      if (signatureEvents.length > 0) {
        const canonical =
          signatureEvents.find((ev) => ev.eventId === sessionForOwner.googleCalendarEventId) ??
          signatureEvents[0];
        const duplicates = signatureEvents.filter((ev) => ev.eventId !== canonical.eventId);
        if (!sessionForOwner.googleCalendarEventId) {
          sessionForOwner = {
            ...sessionForOwner,
            googleCalendarEventId: canonical.eventId,
            googleMeetUrl: sessionForOwner.googleMeetUrl ?? canonical.meetUrl ?? undefined,
          };
        }
        for (const dup of duplicates) {
          if (dup.eventId === canonical.eventId) continue;
          if (dup.eventId === sessionForOwner.googleCalendarEventId) continue;
          try {
            await deleteEvent({
              token: providerToken,
              calendarId: sessionCalendarId,
              eventId: dup.eventId,
              sendUpdates: "none",
            });
          } catch (err) {
            console.error("Google Calendar 중복 이벤트 정리 실패:", err);
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
