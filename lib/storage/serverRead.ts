"use client";

import type { ConsultationRecord, Session, Student, Teacher } from "@/lib/types/index";

type FetchResult<T> = {
  ok: boolean;
  data: T | null;
};

async function fetchServerJson<T>(url: string, dataKey: string): Promise<FetchResult<T>> {
  if (typeof window === "undefined") {
    return { ok: false, data: null };
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
    });
    if (!res.ok) {
      return { ok: false, data: null };
    }

    const body = (await res.json()) as Record<string, unknown>;
    const value = body[dataKey] as T | undefined;
    if (value === undefined) {
      return { ok: false, data: null };
    }

    return { ok: true, data: value };
  } catch {
    return { ok: false, data: null };
  }
}

export async function fetchServerTeachers(): Promise<Teacher[] | null> {
  const result = await fetchServerJson<Teacher[]>("/api/teachers", "teachers");
  return result.ok ? result.data ?? [] : null;
}

export async function fetchServerStudents(): Promise<Student[] | null> {
  const result = await fetchServerJson<Student[]>("/api/students", "students");
  return result.ok ? result.data ?? [] : null;
}

export async function fetchServerStudentSessions(studentId: string): Promise<Session[] | null> {
  const id = (studentId ?? "").trim();
  if (!id) return null;
  const result = await fetchServerJson<Session[]>(`/api/students/${encodeURIComponent(id)}/sessions`, "sessions");
  return result.ok ? result.data ?? [] : null;
}

export async function fetchServerStudentConsultations(studentId: string): Promise<ConsultationRecord[] | null> {
  const id = (studentId ?? "").trim();
  if (!id) return null;
  const result = await fetchServerJson<ConsultationRecord[]>(
    `/api/students/${encodeURIComponent(id)}/consultations`,
    "consultations"
  );
  return result.ok ? result.data ?? [] : null;
}
