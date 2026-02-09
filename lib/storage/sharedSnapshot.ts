"use client";

import { getSupabaseConfig, loadAuthSession } from "@/lib/auth/supabaseAuth";
import type { Student, Teacher } from "@/lib/types/index";

const SNAPSHOT_KEY = "main";
const TEACHERS_KEY = "tutorweb_teachers_v1";
const STUDENTS_KEY = "tutorweb_students_v1";
const STUDENTS_EVENT = "tutorweb:studentsUpdated";
const TEACHERS_EVENT = "tutorweb:teachersUpdated";

type SnapshotRow = {
  teachers?: Teacher[];
  students?: Student[];
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function getAccessToken(): string | null {
  return loadAuthSession()?.accessToken ?? null;
}

function getHeaders(args?: { json?: boolean }): Record<string, string> | null {
  const cfg = getSupabaseConfig();
  const accessToken = getAccessToken();
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

function dispatchLocalSnapshotUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEACHERS_EVENT));
  window.dispatchEvent(new CustomEvent(STUDENTS_EVENT));
}

function applyLocalSnapshot(args: { teachers: Teacher[]; students: Student[] }) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TEACHERS_KEY, JSON.stringify(args.teachers));
  localStorage.setItem(STUDENTS_KEY, JSON.stringify(args.students));
  dispatchLocalSnapshotUpdated();
}

export async function pushSharedSnapshot(args?: {
  teachers?: Teacher[];
  students?: Student[];
}): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) return;

  const headers = getHeaders({ json: true });
  if (!headers) return;

  const teachers = args?.teachers ?? readLocalTeachers();
  const students = args?.students ?? readLocalStudents();

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
      },
    ]),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`snapshot upsert failed: ${res.status} ${text}`);
  }
}

export async function pullSharedSnapshotAndHydrate(): Promise<{
  teachers: Teacher[];
  students: Student[];
} | null> {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const headers = getHeaders();
  if (!headers) return null;

  const url = new URL("/rest/v1/app_state_snapshots", cfg.url);
  url.searchParams.set("select", "teachers,students");
  url.searchParams.set("id", `eq.${SNAPSHOT_KEY}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`snapshot fetch failed: ${res.status} ${text}`);
  }

  const rows = (await res.json()) as SnapshotRow[];
  const row = rows[0];
  if (!row) return null;

  const teachers = Array.isArray(row.teachers) ? row.teachers : [];
  const students = Array.isArray(row.students) ? row.students : [];
  applyLocalSnapshot({ teachers, students });
  return { teachers, students };
}
