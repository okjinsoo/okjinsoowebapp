"use client";
// lib/integrations/googleCalendarApi.ts
/**
 * 구글 캘린더에 실제로 "전화(요청)"를 거는 부분 모음
 *
 * - 요청 보내기(재시도·429 대기·401 자동 재연결 안내 포함)
 * - 앱 전용 캘린더 찾기/만들기(30분 기억)
 * - 일정 만들기/수정/삭제/찾기, 학생용 보조 일정
 *
 * 동기화 흐름(언제 무엇을 올릴지 결정)은 googleCalendarSync.ts가 맡습니다.
 */

import { buildGoogleAuthUrl, loadAuthSession } from "@/lib/auth/supabaseAuth";
import type {
  Session,
  SessionMeta,
  Student,
  Teacher,
} from "@/lib/types/index";
import {
  APP_EVENT_MARKER,
  buildEventPayload,
  buildStudentMirrorPayload,
  delay,
  extractConferenceData,
  extractMeetUrl,
  isGoogleRateLimitError,
  isInsufficientScopeError,
  isManagedStudentEvent,
  isNotFoundError,
  normalizeEmail,
  parseCalendarListItems,
  parseCandidateEvents,
  parseErrorText,
  parseNextPageToken,
  safeIso,
  text,
  type CandidateEvent,
} from "@/lib/integrations/googleCalendarCore";

export const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
export const RATE_LIMIT_BACKOFF_MS = [400, 1000] as const;
export const DUPLICATE_TIME_WINDOW_MS = 5 * 60 * 1000;
export const RECENT_CREATED_TTL_MS = 60 * 1000;
export const APP_CALENDAR_SUMMARY = "옥진수학";

export const APP_CALENDAR_DESCRIPTION = "옥진수학 자동 생성 수업 일정";
export const CALENDAR_CACHE_TTL_MS = 30 * 60 * 1000; // [최적화] 5분 → 30분: 반복 캘린더 목록 조회 대폭 감소
export const GOOGLE_AUTH_ERROR_DEDUP_MS = 15 * 1000;
export const GOOGLE_AUTH_AUTO_REDIRECT_COOLDOWN_MS = 60 * 1000;
export const GOOGLE_AUTH_AUTO_REDIRECT_KEY = "tutorweb_google_auth_auto_redirect_ts_v1";

export let googleAuthRedirecting = false;
export const recentCreatedEventByOwnerSession = new Map<string, { eventId: string; ts: number }>();
export const ownerCalendarIdCache = new Map<string, { calendarId: string; ts: number }>();
export const recentGoogleAuthErrorAt = new Map<string, number>();

 

export function shouldNotifyGoogleAuthError(key: string): boolean {
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

export function canAutoRedirectGoogleAuth(): boolean {
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

export async function tryAutoRecoverGoogleAuth401(): Promise<boolean> {
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

export function ownerSessionKey(ownerEmail: string, sessionId: string): string {
  return `${ownerEmail}::${sessionId}`;
}

export function saveRecentCreatedEvent(args: { ownerEmail: string; sessionId: string; eventId: string }): void {
  if (!args.ownerEmail || !args.sessionId || !args.eventId) return;
  recentCreatedEventByOwnerSession.set(ownerSessionKey(args.ownerEmail, args.sessionId), {
    eventId: args.eventId,
    ts: Date.now(),
  });
}

export function loadRecentCreatedEvent(args: { ownerEmail: string; sessionId: string }): string | null {
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

export async function findNamedCalendarId(args: { token: string; summary: string }): Promise<string | null> {
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

export async function createNamedCalendar(args: { token: string; summary: string }): Promise<string> {
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

export async function ensureAppCalendarId(args: {
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
  _rateLimitAttempt?: number;
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
    const rateLimitAttempt = args._rateLimitAttempt ?? 0;
    if (isGoogleRateLimitError(res.status, msg) && rateLimitAttempt < RATE_LIMIT_BACKOFF_MS.length) {
      await delay(RATE_LIMIT_BACKOFF_MS[rateLimitAttempt]);
      return requestGoogle({
        ...args,
        _rateLimitAttempt: rateLimitAttempt + 1,
      });
    }
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

export function clearOwnerCalendarCache(ownerEmail: string): void {
  const cacheKey = normalizeEmail(ownerEmail);
  if (!cacheKey) return;
  ownerCalendarIdCache.delete(cacheKey);
}

export async function ensureAppCalendarIdWithRecovery(args: {
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

export async function collectManagedEventsWithQuery(args: {
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

export async function listManagedEventsByStudent(args: {
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

export async function purgeManagedEventsForStudent(args: {
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

export async function findSessionEvents(args: {
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

export async function findSignatureEvents(args: {
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

export async function createEvent(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
  teacher: Teacher | null;
  meta?: SessionMeta;
  sendUpdates?: "all" | "none";
  conferenceDataToReuse?: Record<string, unknown> | null;
}): Promise<{
  eventId: string | null;
  meetUrl: string | null;
  conferenceData: Record<string, unknown> | null;
}> {
  const hasPermanent = Boolean(text(args.student.permanentMeetUrl) || text(args.session.googleMeetUrl));
  const payload = buildEventPayload({
    session: args.session,
    student: args.student,
    teacher: args.teacher,
    meta: args.meta,
    includeMeetCreateRequest: !hasPermanent && !args.conferenceDataToReuse,
    conferenceDataToReuse: args.conferenceDataToReuse,
  });
  if (!payload) {
    return { eventId: null, meetUrl: null, conferenceData: null };
  }

  let body: unknown;
  try {
    body = await requestGoogle({
      token: args.token,
      method: "POST",
      path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
      query: {
        conferenceDataVersion: "1",
        sendUpdates: args.sendUpdates ?? "all",
      },
      body: payload,
    });
  } catch (err) {
    // conferenceDataToReuse 가 구글 API 정책상 거부된 경우 conferenceData 없이 안전하게 재시도
    if (args.conferenceDataToReuse) {
      delete payload.conferenceData;
      body = await requestGoogle({
        token: args.token,
        method: "POST",
        path: `/calendars/${encodeURIComponent(args.calendarId)}/events`,
        query: {
          conferenceDataVersion: "1",
          sendUpdates: args.sendUpdates ?? "all",
        },
        body: payload,
      });
    } else {
      throw err;
    }
  }

  const eventId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string)
      : null;
  const meetUrl = extractMeetUrl(body) || text(args.student.permanentMeetUrl) || null;
  const conferenceData = extractConferenceData(body);
  return { eventId, meetUrl, conferenceData };
}

export async function updateEvent(args: {
  token: string;
  calendarId: string;
  session: Session;
  student: Student;
  teacher: Teacher | null;
  meta?: SessionMeta;
  conferenceDataToReuse?: Record<string, unknown> | null;
}): Promise<{
  eventId: string | null;
  meetUrl: string | null;
  conferenceData: Record<string, unknown> | null;
}> {
  const eventId = text(args.session.googleCalendarEventId);
  if (!eventId) return { eventId: null, meetUrl: null, conferenceData: null };

  const hasPermanent = Boolean(text(args.student.permanentMeetUrl) || text(args.session.googleMeetUrl));
  const payload = buildEventPayload({
    session: args.session,
    student: args.student,
    teacher: args.teacher,
    meta: args.meta,
    includeMeetCreateRequest: !hasPermanent && !args.conferenceDataToReuse,
    conferenceDataToReuse: args.conferenceDataToReuse,
  });
  if (!payload) {
    return { eventId: null, meetUrl: null, conferenceData: null };
  }

  let body: unknown;
  try {
    body = await requestGoogle({
      token: args.token,
      method: "PATCH",
      path: `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(eventId)}`,
      query: {
        conferenceDataVersion: "1",
        sendUpdates: "all",
      },
      body: payload,
    });
  } catch (err) {
    // conferenceDataToReuse 가 구글 API 정책상 거부된 경우 conferenceData 없이 안전하게 재시도
    if (args.conferenceDataToReuse) {
      delete payload.conferenceData;
      body = await requestGoogle({
        token: args.token,
        method: "PATCH",
        path: `/calendars/${encodeURIComponent(args.calendarId)}/events/${encodeURIComponent(eventId)}`,
        query: {
          conferenceDataVersion: "1",
          sendUpdates: "all",
        },
        body: payload,
      });
    } else {
      throw err;
    }
  }

  const nextEventId =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).id === "string"
      ? ((body as Record<string, unknown>).id as string)
      : eventId;
  const fallbackMeet = text(args.student.permanentMeetUrl) || text(args.session.googleMeetUrl);
  // 학생의 영구 Meet 링크가 이미 존재한다면, 구글 이벤트 기존 응답보다 영구 링크를 절대 우선 채택!
  const meetUrl = fallbackMeet || extractMeetUrl(body) || null;
  const conferenceData = extractConferenceData(body);
  return { eventId: nextEventId, meetUrl, conferenceData };
}

export async function deleteEvent(args: {
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

export async function upsertStudentMirrorEvent(args: {
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
