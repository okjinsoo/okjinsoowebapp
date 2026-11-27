// lib/integrations/googleCalendarCore.ts
/**
 * 구글 캘린더 동기화의 "순수 계산" 부분 모음
 *
 * 쉽게 말해: 구글에 전화(요청)를 걸지 않고, 저장소도 건드리지 않고,
 * 주어진 값만 보고 답을 내는 함수들입니다. (날짜 계산, 응답 해석, 일정 내용 만들기 등)
 * 그래서 테스트하기 쉽고, 나중에 서버 쪽에서도 그대로 쓸 수 있습니다.
 *
 * googleCalendarSync.ts(구글 요청·동기화 흐름 담당)에서 이 파일을 가져다 씁니다.
 */

import type { Session, SessionMeta, Student, Teacher } from "@/lib/types/index";
import {
  resolveRulesForIndex,
  resolveDurationMinForSessionWithMeta,
} from "@/lib/factories/sessionScheduleResolver";

export const CREATE_PAST_GRACE_MS = 6 * 60 * 60 * 1000; // 6h

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function formatKstRfc3339(isoOrYmd: string): string | null {
  try {
    const dt = new Date(isoOrYmd);
    const ms = dt.getTime();
    if (!Number.isFinite(ms)) return null;
    const kst = new Date(ms + KST_OFFSET_MS);
    const y = String(kst.getUTCFullYear()).padStart(4, "0");
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(kst.getUTCDate()).padStart(2, "0");
    const hh = String(kst.getUTCHours()).padStart(2, "0");
    const mm = String(kst.getUTCMinutes()).padStart(2, "0");
    const ss = String(kst.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}+09:00`;
  } catch {
    return null;
  }
}

export const APP_EVENT_MARKER = "옥진수학 자동 생성 일정";

export const STUDENT_MIRROR_MARKER = "학생용 보조 일정";

export function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function normalizeEmail(v: unknown): string {
  return text(v).toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function safeIso(iso: string): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

export function addMinutes(iso: string, minutes: number): string | null {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(d.getTime() + minutes * 60 * 1000).toISOString();
}

export function collectAttendees(student: Student): Array<{ email: string }> {
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

export function extractMeetUrl(body: unknown): string | null {
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

export function extractConferenceData(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as Record<string, unknown>;
  const conf = rec.conferenceData;
  if (conf && typeof conf === "object" && !Array.isArray(conf)) {
    return conf as Record<string, unknown>;
  }
  return null;
}

export function parseErrorText(body: unknown): string {
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

export type CalendarListItem = {
  id: string;
  summary: string;
  accessRole: string;
  primary: boolean;
};

export function parseCalendarListItems(body: unknown): { items: CalendarListItem[]; nextPageToken: string | null } {
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

export function isGoogleRateLimitError(status: number, message: string): boolean {
  if (status === 429) return true;
  if (status !== 403) return false;
  const lower = text(message).toLowerCase();
  return (
    lower.includes("ratelimitexceeded") ||
    lower.includes("userratelimitexceeded") ||
    lower.includes("quotaexceeded") ||
    lower.includes("rate limit")
  );
}

export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const maxWorkers = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;
  const runners = Array.from({ length: maxWorkers }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/**
 * 학생에게 아직 영구 Meet 링크(permanentMeetUrl)가 없는 경우,
 * 첫 회차 1개만 먼저 직렬 실행(seedTargets)해 단일 Meet 링크를 안전하게 발급·고정한 뒤
 * 나머지 회차들(parallelTargets)을 소규모 병렬 처리하도록 분리합니다.
 */
export function partitionSyncTargetsForMeetSafety(
  orderedTargets: Session[],
  studentById: Map<string, Student>
): { seedTargets: Session[]; parallelTargets: Session[] } {
  const seedTargets: Session[] = [];
  const parallelTargets: Session[] = [];
  const seededStudents = new Set<string>();

  for (const session of orderedTargets) {
    const student = studentById.get(session.studentId);
    const hasPermanentMeet = Boolean(text(student?.permanentMeetUrl));
    if (!hasPermanentMeet && student && !seededStudents.has(student.id)) {
      seededStudents.add(student.id);
      seedTargets.push(session);
    } else {
      parallelTargets.push(session);
    }
  }

  return { seedTargets, parallelTargets };
}

export function isNotFoundError(message: string): boolean {
  return text(message).startsWith("404");
}

export function sessionNeedsUpsert(previous: Session | undefined, next: Session): boolean {
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

export function shouldCreateFor(next: Session): boolean {
  const iso = safeIso(next.displayAt);
  if (!iso) return false;
  return new Date(iso).getTime() >= Date.now() - CREATE_PAST_GRACE_MS;
}

export function hasDisplayAtChanged(previous: Session | undefined, next: Session): boolean {
  if (!previous) return false;
  const prevIso = safeIso(previous.displayAt);
  const nextIso = safeIso(next.displayAt);
  if (prevIso && nextIso) return prevIso !== nextIso;
  return previous.displayAt !== next.displayAt;
}

export function calendarIdOf(session: Session | undefined): string {
  return text(session?.googleCalendarId) || "primary";
}

export function isPrimaryCalendarId(calendarId: string): boolean {
  return text(calendarId) === "primary";
}

export function isPermissionOrNotFound(message: string): boolean {
  const msg = text(message);
  return msg.startsWith("403") || msg.startsWith("404");
}

export function isInsufficientScopeError(message: string): boolean {
  const msg = text(message).toLowerCase();
  return (
    msg.includes("insufficient authentication scopes") ||
    msg.includes("insufficient permission") ||
    msg.includes("insufficientpermissions")
  );
}

export type CandidateEvent = {
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

export function parseCandidateEvents(body: unknown): CandidateEvent[] {
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

export function parseNextPageToken(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  return text((body as Record<string, unknown>).nextPageToken);
}

export function isManagedStudentEvent(args: {
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

export function buildEventPayload(args: {
  session: Session;
  student: Student;
  teacher: Teacher | null;
  includeMeetCreateRequest: boolean;
  meta?: SessionMeta;
  conferenceDataToReuse?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const startIso = safeIso(args.session.displayAt);
  if (!startIso) return null;

  const rules = resolveRulesForIndex(args.student, args.session.index);
  const durationMin = resolveDurationMinForSessionWithMeta(startIso, rules, args.meta);
  const endIso = addMinutes(startIso, durationMin);
  if (!endIso) return null;

  const startKst = formatKstRfc3339(startIso) ?? startIso;
  const endKst = formatKstRfc3339(endIso) ?? endIso;

  const summary = `${args.student.name} ${args.session.index}회차 수업`;
  const effectiveMeetUrl = text(args.student.permanentMeetUrl) || text(args.session.googleMeetUrl);
  const descriptionLines = [
    APP_EVENT_MARKER,
    `학생: ${args.student.name}`,
    args.teacher ? `선생님: ${args.teacher.name}` : "",
    `회차: ${args.session.index}`,
    `수업시간: ${durationMin}분`,
    effectiveMeetUrl ? `Google Meet: ${effectiveMeetUrl}` : "",
    args.session.memo ? `메모: ${args.session.memo}` : "",
  ].filter((line) => Boolean(line));

  const attendees = collectAttendees(args.student);

  const payload: Record<string, unknown> = {
    summary,
    description: descriptionLines.join("\n"),
    location: effectiveMeetUrl || undefined,
    status: "confirmed",
    start: {
      dateTime: startKst,
      timeZone: "Asia/Seoul",
    },
    end: {
      dateTime: endKst,
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

  if (args.conferenceDataToReuse) {
    payload.conferenceData = args.conferenceDataToReuse;
  } else if (args.includeMeetCreateRequest && !effectiveMeetUrl) {
    payload.conferenceData = {
      createRequest: {
        requestId: `tutorweb-${args.session.id}-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return payload;
}

export function buildStudentMirrorPayload(args: {
  session: Session;
  student: Student;
  teacher: Teacher | null;
  meta?: SessionMeta;
}): Record<string, unknown> | null {
  const startIso = safeIso(args.session.displayAt);
  if (!startIso) return null;

  const rules = resolveRulesForIndex(args.student, args.session.index);
  const durationMin = resolveDurationMinForSessionWithMeta(startIso, rules, args.meta);
  const endIso = addMinutes(startIso, durationMin);
  if (!endIso) return null;

  const startKst = formatKstRfc3339(startIso) ?? startIso;
  const endKst = formatKstRfc3339(endIso) ?? endIso;

  const meetUrl = text(args.session.googleMeetUrl);
  const descriptionLines = [
    APP_EVENT_MARKER,
    STUDENT_MIRROR_MARKER,
    `학생: ${args.student.name}`,
    args.teacher ? `선생님: ${args.teacher.name}` : "",
    `회차: ${args.session.index}`,
    `수업시간: ${durationMin}분`,
    meetUrl ? `Meet 링크: ${meetUrl}` : "",
    args.session.memo ? `메모: ${args.session.memo}` : "",
  ].filter((line) => Boolean(line));

  return {
    summary: `${args.student.name} ${args.session.index}회차 수업`,
    description: descriptionLines.join("\n"),
    ...(meetUrl ? { location: meetUrl } : {}),
    start: {
      dateTime: startKst,
      timeZone: "Asia/Seoul",
    },
    end: {
      dateTime: endKst,
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

// ───────────────────────── 동기화 대상 고르기 (runSync에서 분리) ─────────────────────────

/** 화면에 보이는(동기화 대상이 될 수 있는) 회차만 남깁니다. 현재는 모든 회차를 그대로 돌려줍니다. */
export function filterVisibleSessions(student: Student, sessions: Session[]): Session[] {
  void student;
  return sessions;
}

/**
 * 1차 후보: 로그인 확인 전에 "오류 표시를 붙일 수도 있는" 회차들.
 * pending/error 상태이거나, 바뀐 내용이 있으면서 (이미 일정이 있거나 아직 지나지 않은) 회차.
 */
export function selectProvisionalSyncTargets(
  previousById: Map<string, Session>,
  correctedNext: Session[]
): Session[] {
  return correctedNext.filter((next) => {
    const prev = previousById.get(next.id);
    const status = text(next.googleCalendarStatus);
    if (status === "pending" || status === "error") return true;
    if (!sessionNeedsUpsert(prev, next)) return false;
    if (!next.googleCalendarEventId && !shouldCreateFor(next)) return false;
    return true;
  });
}

/**
 * 최종 대상: 상태(pending/error), 내용 변경, 담당 선생님 이메일 불일치(ownerDrift),
 * 학생 영구 Meet 링크 불일치(meetDrift) 중 하나라도 있으면 다시 올립니다.
 */
export function selectSyncTargets(args: {
  visibleNextSessions: Session[];
  previousById: Map<string, Session>;
  studentById: Map<string, Student>;
  teacherById: Map<string, Teacher>;
}): Session[] {
  const { previousById, studentById, teacherById } = args;
  return args.visibleNextSessions.filter((next) => {
    const prev = previousById.get(next.id);
    const status = text(next.googleCalendarStatus);
    const statusDriven = status === "pending" || status === "error";
    const diffDriven = sessionNeedsUpsert(prev, next);

    const student = studentById.get(next.studentId);
    const teacher = student?.teacherId ? teacherById.get(student.teacherId) ?? null : null;
    const expectedOwnerEmail = normalizeEmail(teacher?.email);
    const savedOwnerEmail = normalizeEmail(next.googleCalendarOwnerEmail);
    const ownerDrift = Boolean(expectedOwnerEmail) && expectedOwnerEmail !== savedOwnerEmail;

    const permanentMeet = text(student?.permanentMeetUrl);
    const sessionMeet = text(next.googleMeetUrl);
    const meetDrift = Boolean(permanentMeet) && permanentMeet !== sessionMeet;

    if (!statusDriven && !diffDriven && !ownerDrift && !meetDrift) return false;
    if (!next.googleCalendarEventId && !shouldCreateFor(next) && !statusDriven && !ownerDrift && !meetDrift) return false;
    return true;
  });
}

/**
 * 사라진 회차 중 구글 일정을 지워야 하는 것만 고릅니다. (실제 삭제 요청은 호출하는 쪽에서)
 * 조건: 이번 목록에 없음 + 일정 ID 있음 + 담당 선생님 = 지금 로그인한 사람 + 기본(primary) 캘린더가 아님
 */
export function selectRemovedEventsToDelete(args: {
  previous: Session[];
  visibleIds: Set<string>;
  studentById: Map<string, Student>;
  teacherById: Map<string, Teacher>;
  currentEmail: string;
}): Session[] {
  const out: Session[] = [];
  for (const prev of args.previous) {
    if (args.visibleIds.has(prev.id)) continue;
    if (!prev.googleCalendarEventId) continue;
    const prevStudent = args.studentById.get(prev.studentId);
    const prevTeacher = prevStudent?.teacherId ? args.teacherById.get(prevStudent.teacherId) ?? null : null;
    const expectedOwnerEmail = normalizeEmail(prevTeacher?.email);
    if (!expectedOwnerEmail || expectedOwnerEmail !== args.currentEmail) continue;
    if (isPrimaryCalendarId(calendarIdOf(prev))) continue;
    out.push(prev);
  }
  return out;
}

/** 수업 시각이 빠른 순서(같으면 회차 번호 순)로 정렬한 새 배열을 돌려줍니다. */
export function orderSyncTargets(targets: Session[]): Session[] {
  return [...targets].sort((a, b) => {
    const ta = new Date(a.displayAt).getTime();
    const tb = new Date(b.displayAt).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.index - b.index;
  });
}
