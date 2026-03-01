"use client";

import type { ConsultationRecord, Session, Student, Teacher } from "@/lib/types/index";

type FetchResult<T> = {
  ok: boolean;
  data: T | null;
};

const SOFT_CACHE_TTL_MS = 1500;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightRequests = new Map<string, Promise<FetchResult<unknown>>>();

async function fetchServerJson<T>(url: string, dataKey: string): Promise<FetchResult<T>> {
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
