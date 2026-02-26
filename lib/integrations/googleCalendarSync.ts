"use client";

import { loadAuthSession } from "@/lib/auth/supabaseAuth";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers } from "@/lib/storage/teachers";
import type { Session, Student, Teacher } from "@/lib/types/index";

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
const DEFAULT_DURATION_MIN = 90;
const SYNC_DEBOUNCE_MS = 900;
const CREATE_PAST_GRACE_MS = 6 * 60 * 60 * 1000; // 6h

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let pending: SyncArgs | null = null;
let syncInFlight = false;

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function collectAttendees(student: Student, teacher: Teacher | null): Array<{ email: string }> {
  const out: Array<{ email: string }> = [];
  const used = new Set<string>();

  const push = (emailRaw: string | undefined) => {
    const email = text(emailRaw).toLowerCase();
    if (!email || !isValidEmail(email) || used.has(email)) return;
    used.add(email);
    out.push({ email });
  };

  push(student.googleEmail);
  push(teacher?.email);
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

async function requestGoogle(args: {
  token: string;
  method: "POST" | "PATCH" | "DELETE";
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
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
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
    throw new Error(`${res.status} ${msg}`);
  }

  return body;
}

function sessionNeedsUpsert(previous: Session | undefined, next: Session): boolean {
  if (!next.googleCalendarEventId) return true;
  if (!previous) return true;
  return (
    previous.displayAt !== next.displayAt ||
    previous.index !== next.index ||
    previous.studentId !== next.studentId ||
    (previous.title ?? "") !== (next.title ?? "") ||
    (previous.memo ?? "") !== (next.memo ?? "")
  );
}

function shouldCreateFor(next: Session): boolean {
  const iso = safeIso(next.displayAt);
  if (!iso) return false;
  return new Date(iso).getTime() >= Date.now() - CREATE_PAST_GRACE_MS;
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
    "옥진수학 자동 생성 일정",
    `학생: ${args.student.name}`,
    args.teacher ? `선생님: ${args.teacher.name}` : "",
    `회차: ${args.session.index}`,
    args.session.memo ? `메모: ${args.session.memo}` : "",
  ].filter((line) => Boolean(line));

  const attendees = collectAttendees(args.student, args.teacher);

  const payload: Record<string, unknown> = {
    summary,
    description: descriptionLines.join("\n"),
    start: {
      dateTime: startIso,
      timeZone: "Asia/Seoul",
    },
    end: {
      dateTime: endIso,
      timeZone: "Asia/Seoul",
    },
    attendees,
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
  session: Session;
  student: Student;
  teacher: Teacher | null;
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
    path: "/calendars/primary/events",
    query: {
      conferenceDataVersion: "1",
      sendUpdates: "all",
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
    path: `/calendars/primary/events/${encodeURIComponent(eventId)}`,
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

async function deleteEvent(args: { token: string; eventId: string }): Promise<void> {
  const eventId = text(args.eventId);
  if (!eventId) return;

  try {
    await requestGoogle({
      token: args.token,
      method: "DELETE",
      path: `/calendars/primary/events/${encodeURIComponent(eventId)}`,
      query: {
        sendUpdates: "all",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    // 이미 지워진 이벤트는 동기화 성공으로 취급
    if (msg.startsWith("404")) return;
    throw err;
  }
}

async function runSync(args: SyncArgs): Promise<void> {
  const auth = loadAuthSession();
  const providerToken = text(auth?.providerAccessToken);
  if (!providerToken) return;

  if (auth?.providerExpiresAt && Date.now() >= auth.providerExpiresAt - 15 * 1000) {
    return;
  }

  const students = loadStudents();
  const teachers = loadTeachers();
  const studentById = new Map(students.map((s) => [s.id, s] as const));
  const teacherById = new Map(teachers.map((t) => [t.id, t] as const));
  const previousById = new Map(args.previous.map((s) => [s.id, s] as const));
  const nextById = new Map(args.next.map((s) => [s.id, s] as const));
  const patches: SessionPatch[] = [];

  for (const prev of args.previous) {
    if (nextById.has(prev.id)) continue;
    if (!prev.googleCalendarEventId) continue;
    try {
      await deleteEvent({ token: providerToken, eventId: prev.googleCalendarEventId });
    } catch (err) {
      console.error("Google Calendar 이벤트 삭제 실패:", err);
    }
  }

  const orderedNext = [...args.next].sort((a, b) => {
    const ta = new Date(a.displayAt).getTime();
    const tb = new Date(b.displayAt).getTime();
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.index - b.index;
  });

  for (const next of orderedNext) {
    const prev = previousById.get(next.id);
    if (!sessionNeedsUpsert(prev, next)) continue;
    if (!next.googleCalendarEventId && !shouldCreateFor(next)) continue;

    const student = studentById.get(next.studentId);
    if (!student) continue;

    const teacher = student.teacherId ? teacherById.get(student.teacherId) ?? null : null;

    try {
      const result = next.googleCalendarEventId
        ? await updateEvent({
            token: providerToken,
            session: next,
            student,
            teacher,
          })
        : await createEvent({
            token: providerToken,
            session: next,
            student,
            teacher,
          });

      patches.push({
        id: next.id,
        patch: {
          googleCalendarEventId: result.eventId ?? undefined,
          googleMeetUrl: result.meetUrl ?? undefined,
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
