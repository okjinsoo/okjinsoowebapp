"use client";

import { loadSessions } from "@/lib/storage/sessions";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers, TEACHERS_EVENT } from "@/lib/storage/teachers";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import type { Session, Student, Teacher } from "@/lib/types/index";

type FetchResult<T> = {
  ok: boolean;
  data: T | null;
};

type ServerFirstSource = "server" | "local";

const SOFT_CACHE_TTL_MS = 5000;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<FetchResult<unknown>>>();

export function invalidateServerReadCache(): void {
  responseCache.clear();
}

if (typeof window !== "undefined") {
  window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, invalidateServerReadCache);
  window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, invalidateServerReadCache);
  window.addEventListener(TEACHERS_EVENT, invalidateServerReadCache);
  window.addEventListener(AUTH_EVENT, invalidateServerReadCache);
  window.addEventListener("storage", (e: StorageEvent) => {
    if (
      e.key === null ||
      e.key === "tutorweb_students_v1" ||
      e.key === "tutorweb_teachers_v1" ||
      e.key === "tutorweb_sessions_v1" ||
      (e.key && e.key.startsWith("tutorweb_auth_session"))
    ) {
      invalidateServerReadCache();
    }
  });
}

function stripLegacyStudentFields(student: Student): Student {
  const next = { ...student } as Student & {
    consultationHistory?: unknown;
    pauseEffectiveDate?: unknown;
    pauseStatus?: unknown;
  };
  delete next.consultationHistory;
  delete next.pauseEffectiveDate;
  delete next.pauseStatus;
  return next as Student;
}

function normalizeStudents(rows: Student[]): Student[] {
  return rows.map(stripLegacyStudentFields);
}

function isLocalOnlyMode(): boolean {
  return process.env.NEXT_PUBLIC_TUTORWEB_LOCAL_ONLY === "1";
}

export async function fetchServerJson<T>(url: string, dataKey: string): Promise<FetchResult<T>> {
  if (typeof window === "undefined") {
    return { ok: false, data: null };
  }

  if (isLocalOnlyMode()) {
    return { ok: false, data: null };
  }

  const cacheKey = `${url}::${dataKey}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return { ok: true, data: (cached.value as T) ?? null };
  }

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) {
    return (await inFlight) as FetchResult<T>;
  }

  const requestPromise = (async (): Promise<FetchResult<unknown>> => {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
      });
      if (!res.ok) {
        return { ok: false, data: null };
      }

      const body = (await res.json()) as Record<string, unknown>;
      const value = body[dataKey];
      if (value === undefined) {
        return { ok: false, data: null };
      }

      responseCache.set(cacheKey, {
        expiresAt: Date.now() + SOFT_CACHE_TTL_MS,
        value,
      });
      return { ok: true, data: value ?? null };
    } catch {
      return { ok: false, data: null };
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, requestPromise);

  try {
    return (await requestPromise) as FetchResult<T>;
  } catch {
    return { ok: false, data: null };
  }
}

function ensureArray<T>(value: T[] | null): T[] | null {
  return Array.isArray(value) ? value : null;
}

export async function readStudentsServerFirst(): Promise<{
  students: Student[];
  source: ServerFirstSource;
}> {
  const server = await fetchServerJson<Student[]>("/api/students", "students");
  const serverRows = ensureArray(server.data);
  if (server.ok && serverRows) {
    return {
      students: normalizeStudents(serverRows),
      source: "server",
    };
  }

  return {
    students: normalizeStudents(loadStudents()),
    source: "local",
  };
}

export async function readStudentsServerRequired(): Promise<Student[]> {
  const result = await readStudentsServerFirst();
  if (result.source !== "server") {
    throw new Error("server_students_unavailable");
  }
  return result.students;
}

export async function readTeachersServerFirst(): Promise<{
  teachers: Teacher[];
  source: ServerFirstSource;
}> {
  const server = await fetchServerJson<Teacher[]>("/api/teachers", "teachers");
  const serverRows = ensureArray(server.data);
  if (server.ok && serverRows) {
    return {
      teachers: serverRows,
      source: "server",
    };
  }

  return {
    teachers: loadTeachers(),
    source: "local",
  };
}

export async function readTeachersServerRequired(): Promise<Teacher[]> {
  const result = await readTeachersServerFirst();
  if (result.source !== "server") {
    throw new Error("server_teachers_unavailable");
  }
  return result.teachers;
}

export async function readRosterServerFirst(): Promise<{
  students: Student[];
  teachers: Teacher[];
  source: {
    students: ServerFirstSource;
    teachers: ServerFirstSource;
  };
}> {
  const [studentResult, teacherResult] = await Promise.all([
    readStudentsServerFirst(),
    readTeachersServerFirst(),
  ]);

  return {
    students: studentResult.students,
    teachers: teacherResult.teachers,
    source: {
      students: studentResult.source,
      teachers: teacherResult.source,
    },
  };
}

type SnapshotPayload = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
};

function ensureObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function buildStudentSessionsFromRows(args: {
  student: Student;
  allSessions: Session[];
}): Session[] {
  const realSessions = args.allSessions
    .filter((session) => session.studentId === args.student.id)
    .sort((a, b) => a.index - b.index);

  const planCount = args.student.planCount || 12;
  const sessionsByIndex = new Map(realSessions.map((session) => [session.index, session]));
  const results: Session[] = [];

  for (let i = 1; i <= planCount; i += 1) {
    const existing = sessionsByIndex.get(i);
    if (existing) {
      results.push(existing);
      continue;
    }
    results.push({
      id: `virtual_${args.student.id}_${i}`,
      studentId: args.student.id,
      index: i,
      displayAt: "",
      state: "normal",
    });
  }

  return results;
}

export function findStudentByTokenInRows(token: string, students: Student[]): Student | null {
  if (!token) return null;
  return students.find((student) => student.token === token) ?? null;
}

export async function readSnapshotServerFirst(): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
  source: ServerFirstSource;
}> {
  const server = await fetchServerJson<SnapshotPayload>("/api/snapshot", "snapshot");
  const snapshot = ensureObject(server.data);
  if (server.ok && snapshot) {
    const teachers = Array.isArray(snapshot.teachers)
      ? (snapshot.teachers as Teacher[])
      : [];
    const students = Array.isArray(snapshot.students)
      ? normalizeStudents(snapshot.students as Student[])
      : [];
    const sessions = Array.isArray(snapshot.sessions)
      ? (snapshot.sessions as Session[])
      : [];
    return {
      teachers,
      students,
      sessions,
      source: "server",
    };
  }

  return {
    teachers: loadTeachers(),
    students: normalizeStudents(loadStudents()),
    sessions: loadSessions(),
    source: "local",
  };
}

export async function readSnapshotServerRequired(): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
  source: "server";
}> {
  const result = await readSnapshotServerFirst();
  if (result.source !== "server") {
    throw new Error("server_snapshot_unavailable");
  }
  return {
    ...result,
    source: "server",
  };
}

export async function readStudentContextServerFirst(token: string): Promise<{
  student: Student | null;
  sessions: Session[];
  source: ServerFirstSource;
}> {
  const snapshot = await readSnapshotServerFirst();
  const student = findStudentByTokenInRows(token, snapshot.students);

  if (!student) {
    return {
      student: null,
      sessions: [],
      source: snapshot.source,
    };
  }

  return {
    student,
    sessions: buildStudentSessionsFromRows({
      student,
      allSessions: snapshot.sessions,
    }),
    source: snapshot.source,
  };
}

export async function readStudentContextServerRequired(token: string): Promise<{
  student: Student | null;
  sessions: Session[];
  source: "server";
}> {
  const result = await readStudentContextServerFirst(token);
  if (result.source !== "server") {
    throw new Error("server_student_context_unavailable");
  }
  return {
    ...result,
    source: "server",
  };
}
