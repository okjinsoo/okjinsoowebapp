"use client";

import { loadAllConsultationsStore } from "@/lib/storage/consultations";
import { loadSessions } from "@/lib/storage/sessions";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers } from "@/lib/storage/teachers";
import { SHARED_CONSULTATIONS_KEY } from "@/lib/storage/sharedStateKeys";
import type { ConsultationRecord, Session, Student, Teacher } from "@/lib/types/index";

type FetchResult<T> = {
  ok: boolean;
  data: T | null;
};

type ServerFirstSource = "server" | "local";

const SOFT_CACHE_TTL_MS = 1500;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<FetchResult<unknown>>>();

export async function fetchServerJson<T>(url: string, dataKey: string): Promise<FetchResult<T>> {
  if (typeof window === "undefined") {
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
      students: serverRows,
      source: "server",
    };
  }

  return {
    students: loadStudents(),
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
  stateKv?: Record<string, string> | null;
};

type ConsultStore = Record<string, ConsultationRecord[]>;

function ensureObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseConsultStore(raw: unknown): ConsultStore {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    const obj = ensureObject(parsed);
    if (!obj) return {};

    const out: ConsultStore = {};
    for (const [studentId, list] of Object.entries(obj)) {
      if (!Array.isArray(list)) continue;
      out[studentId] = list as ConsultationRecord[];
    }
    return out;
  } catch {
    return {};
  }
}

function readConsultStoreFromSnapshot(snapshot: SnapshotPayload): ConsultStore {
  const stateKv = ensureObject(snapshot.stateKv ?? null);
  if (!stateKv) return {};
  return parseConsultStore(stateKv[SHARED_CONSULTATIONS_KEY]);
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
  consultations: ConsultStore;
  source: ServerFirstSource;
}> {
  const server = await fetchServerJson<SnapshotPayload>("/api/snapshot", "snapshot");
  const snapshot = ensureObject(server.data);
  if (server.ok && snapshot) {
    const teachers = Array.isArray(snapshot.teachers)
      ? (snapshot.teachers as Teacher[])
      : [];
    const students = Array.isArray(snapshot.students)
      ? (snapshot.students as Student[])
      : [];
    const sessions = Array.isArray(snapshot.sessions)
      ? (snapshot.sessions as Session[])
      : [];
    return {
      teachers,
      students,
      sessions,
      consultations: readConsultStoreFromSnapshot(snapshot as SnapshotPayload),
      source: "server",
    };
  }

  return {
    teachers: loadTeachers(),
    students: loadStudents(),
    sessions: loadSessions(),
    consultations: loadAllConsultationsStore() as ConsultStore,
    source: "local",
  };
}

export async function readSnapshotServerRequired(): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
  consultations: ConsultStore;
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
  consultations: ConsultationRecord[];
  source: ServerFirstSource;
}> {
  const snapshot = await readSnapshotServerFirst();
  const student = findStudentByTokenInRows(token, snapshot.students);

  if (!student) {
    return {
      student: null,
      sessions: [],
      consultations: [],
      source: snapshot.source,
    };
  }

  return {
    student,
    sessions: buildStudentSessionsFromRows({
      student,
      allSessions: snapshot.sessions,
    }),
    consultations: snapshot.consultations[student.id] ?? [],
    source: snapshot.source,
  };
}

export async function readStudentContextServerRequired(token: string): Promise<{
  student: Student | null;
  sessions: Session[];
  consultations: ConsultationRecord[];
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
