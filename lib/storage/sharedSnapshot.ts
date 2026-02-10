"use client";

import { getSupabaseConfig, getValidAccessToken } from "@/lib/auth/supabaseAuth";
import type { Session, Student, Teacher } from "@/lib/types/index";

const SNAPSHOT_KEY = "main";
const TEACHERS_KEY = "tutorweb_teachers_v1";
const STUDENTS_KEY = "tutorweb_students_v1";
const SESSIONS_KEY = "tutorweb_sessions_v1";
const STUDENTS_EVENT = "tutorweb:studentsUpdated";
const TEACHERS_EVENT = "tutorweb:teachersUpdated";
const SESSIONS_EVENT = "tutorweb:sessionsUpdated";
const PULL_COOLDOWN_MS = 5000;

type SnapshotRow = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
};

export type PushSharedSnapshotResult = {
  sessionsSynced: boolean;
};

let lastPullSnapshotAt = 0;
let pullSnapshotInFlight: Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
} | null> | null = null;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function getHeaders(args?: { json?: boolean }): Promise<Record<string, string> | null> {
  const cfg = getSupabaseConfig();
  const accessToken = await getValidAccessToken();
  if (!cfg || !accessToken) return null;

  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  if (args?.json) headers["Content-Type"] = "application/json";
  return headers;
}

export function readLocalTeachers(): Teacher[] {
  if (typeof window === "undefined") return [];
  return safeParse<Teacher[]>(localStorage.getItem(TEACHERS_KEY), []);
}

export function readLocalStudents(): Student[] {
  if (typeof window === "undefined") return [];
  return safeParse<Student[]>(localStorage.getItem(STUDENTS_KEY), []);
}

export function readLocalSessions(): Session[] {
  if (typeof window === "undefined") return [];
  return safeParse<Session[]>(localStorage.getItem(SESSIONS_KEY), []);
}

function dispatchLocalSnapshotUpdated(args?: { includeSessions?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEACHERS_EVENT));
  window.dispatchEvent(new CustomEvent(STUDENTS_EVENT));
  if (args?.includeSessions) {
    window.dispatchEvent(new CustomEvent(SESSIONS_EVENT));
  }
}

function applyLocalSnapshot(args: { teachers: Teacher[]; students: Student[]; sessions?: Session[] }) {
  if (typeof window === "undefined") return;
  let changed = false;
  let sessionsChanged = false;

  const teachersRaw = JSON.stringify(args.teachers);
  if (localStorage.getItem(TEACHERS_KEY) !== teachersRaw) {
    localStorage.setItem(TEACHERS_KEY, teachersRaw);
    changed = true;
  }

  const studentsRaw = JSON.stringify(args.students);
  if (localStorage.getItem(STUDENTS_KEY) !== studentsRaw) {
    localStorage.setItem(STUDENTS_KEY, studentsRaw);
    changed = true;
  }

  const includeSessions = Array.isArray(args.sessions);
  if (includeSessions) {
    const sessionsRaw = JSON.stringify(args.sessions ?? []);
    if (localStorage.getItem(SESSIONS_KEY) !== sessionsRaw) {
      localStorage.setItem(SESSIONS_KEY, sessionsRaw);
      sessionsChanged = true;
    }
  }

  if (changed || sessionsChanged) {
    dispatchLocalSnapshotUpdated({ includeSessions: sessionsChanged });
  }
}

function isMissingColumnError(detail: string, column: string): boolean {
  const lower = detail.toLowerCase();
  return lower.includes(column.toLowerCase()) && (lower.includes("column") || lower.includes("schema cache") || lower.includes("42703"));
}

function hasLocalSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(TEACHERS_KEY) !== null && localStorage.getItem(STUDENTS_KEY) !== null;
}

export async function pushSharedSnapshot(args?: {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
}): Promise<PushSharedSnapshotResult> {
  const cfg = getSupabaseConfig();
  if (!cfg) return { sessionsSynced: false };

  const headers = await getHeaders({ json: true });
  if (!headers) return { sessionsSynced: false };

  const teachers = args?.teachers ?? readLocalTeachers();
  const students = args?.students ?? readLocalStudents();
  const sessions = args?.sessions ?? readLocalSessions();

  const url = new URL("/rest/v1/app_state_snapshots", cfg.url);
  url.searchParams.set("on_conflict", "id");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      {
        id: SNAPSHOT_KEY,
        teachers,
        students,
        sessions,
      },
    ]),
  });

  if (res.ok) return { sessionsSynced: true };

  const text = await res.text();
  if (!isMissingColumnError(text, "sessions")) {
    throw new Error(`snapshot upsert failed: ${res.status} ${text}`);
  }

  const fallbackRes = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      {
        id: SNAPSHOT_KEY,
        teachers,
        students,
      },
    ]),
  });

  if (!fallbackRes.ok) {
    const fallbackText = await fallbackRes.text();
    throw new Error(`snapshot upsert failed (fallback): ${fallbackRes.status} ${fallbackText}`);
  }

  return { sessionsSynced: false };
}

export async function pullSharedSnapshotAndHydrate(): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
} | null> {
  if (Date.now() - lastPullSnapshotAt < PULL_COOLDOWN_MS && hasLocalSnapshot()) {
    return {
      teachers: readLocalTeachers(),
      students: readLocalStudents(),
      sessions: readLocalSessions(),
    };
  }

  if (pullSnapshotInFlight) {
    return pullSnapshotInFlight;
  }

  pullSnapshotInFlight = (async () => {
    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    const headers = await getHeaders();
    if (!headers) return null;

    const fetchRows = async (select: string): Promise<{ rows: SnapshotRow[]; missingSessionsColumn: boolean }> => {
      const url = new URL("/rest/v1/app_state_snapshots", cfg.url);
      url.searchParams.set("select", select);
      url.searchParams.set("id", `eq.${SNAPSHOT_KEY}`);
      url.searchParams.set("limit", "1");

      const res = await fetch(url.toString(), {
        method: "GET",
        headers,
      });

      if (res.ok) {
        return { rows: (await res.json()) as SnapshotRow[], missingSessionsColumn: false };
      }

      const text = await res.text();
      if (select.includes("sessions") && isMissingColumnError(text, "sessions")) {
        return { rows: [], missingSessionsColumn: true };
      }

      throw new Error(`snapshot fetch failed: ${res.status} ${text}`);
    };

    let usedLegacySnapshot = false;
    let rowsResult = await fetchRows("teachers,students,sessions");
    if (rowsResult.missingSessionsColumn) {
      usedLegacySnapshot = true;
      rowsResult = await fetchRows("teachers,students");
    }

    const rows = rowsResult.rows;
    const row = rows[0];
    if (!row) return null;

    const teachers = Array.isArray(row.teachers) ? row.teachers : [];
    const students = Array.isArray(row.students) ? row.students : [];
    const sessions = Array.isArray(row.sessions) ? row.sessions : [];

    if (usedLegacySnapshot) {
      applyLocalSnapshot({ teachers, students });
      lastPullSnapshotAt = Date.now();
      return { teachers, students, sessions: readLocalSessions() };
    }

    applyLocalSnapshot({ teachers, students, sessions });
    lastPullSnapshotAt = Date.now();
    return { teachers, students, sessions };
  })();

  try {
    return await pullSnapshotInFlight;
  } finally {
    pullSnapshotInFlight = null;
  }
}
