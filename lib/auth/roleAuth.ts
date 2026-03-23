"use client";

import {
  canAccessRole as canAccessRoleByPolicy,
  type RequiredRole,
} from "@/lib/auth/accessPolicy";
import { fetchRoleBinding } from "@/lib/auth/roleBindings";
import { browserStorage } from "@/lib/storage/browserStorage";
import type { Student, Teacher } from "@/lib/types/index";

export type UserRole = "guest" | "student" | "teacher" | "admin";
export type { RequiredRole } from "@/lib/auth/accessPolicy";

// 요청 반영: 관리자 기본 계정 고정
const FIXED_ADMIN_EMAILS = ["rapah0310@gmail.com"];
const ROLE_CACHE_KEY = "tutorweb_last_roles_v1";
const ROLE_CACHE_TTL_MS = 10 * 60 * 1000;

type RoleCacheMap = Record<string, { role: UserRole; ts: number }>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type SnapshotResponse = {
  snapshot?: {
    teachers?: Teacher[];
    students?: Student[];
  };
};

async function resolveSnapshotRoleByEmail(args: {
  email: string;
  accessToken: string;
}): Promise<UserRole | null> {
  if (typeof window === "undefined") return null;

  try {
    const res = await fetch("/api/snapshot", {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
      },
    });
    if (!res.ok) return null;

    const body = (await res.json()) as SnapshotResponse;
    const teachers = Array.isArray(body.snapshot?.teachers) ? body.snapshot?.teachers : [];
    if (teachers.some((teacher) => normalizeEmail(teacher.email ?? "") === args.email)) {
      return "teacher";
    }

    const students = Array.isArray(body.snapshot?.students) ? body.snapshot?.students : [];
    if (students.some((student) => normalizeEmail(student.googleEmail ?? "") === args.email)) {
      return "student";
    }
  } catch {
    return null;
  }
  return null;
}

export function getAdminEmailSet(): Set<string> {
  return new Set(FIXED_ADMIN_EMAILS.map(normalizeEmail));
}

function readRoleCache(): RoleCacheMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = browserStorage.getItem(ROLE_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RoleCacheMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeRoleCache(next: RoleCacheMap): void {
  if (typeof window === "undefined") return;
  browserStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(next));
}

export function loadCachedRole(email: string): UserRole | null {
  if (!email) return null;
  const cache = readRoleCache();
  const row = cache[email];
  if (!row) return null;
  if (Date.now() - row.ts > ROLE_CACHE_TTL_MS) return null;
  return row.role;
}

function saveCachedRole(email: string, role: UserRole): void {
  if (!email || role === "guest") return;
  const cache = readRoleCache();
  cache[email] = { role, ts: Date.now() };
  writeRoleCache(cache);
}

function clearCachedRole(email: string): void {
  if (!email) return;
  const cache = readRoleCache();
  if (!(email in cache)) return;
  delete cache[email];
  writeRoleCache(cache);
}

export async function resolveUserRole(args: {
  email: string | null | undefined;
  accessToken: string | null | undefined;
}): Promise<UserRole> {
  const { email, accessToken } = args;
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) return "guest";

  if (getAdminEmailSet().has(normalized)) {
    saveCachedRole(normalized, "admin");
    return "admin";
  }
  if (!accessToken) return "guest";
  
  // [최적화] 캐시가 있으면 즉시 반환하여 UI 속도 향상 (SWR 방식)
  const cached = loadCachedRole(normalized);
  if (cached) return cached;

  try {
    const role = await fetchRoleBinding({ email: normalized, accessToken });
    if (role === "teacher" || role === "student") {
      saveCachedRole(normalized, role);
      return role;
    }

    // role_bindings 지연 반영 시 서버 스냅샷 데이터로 1차 보강
    const snapshotRole = await resolveSnapshotRoleByEmail({
      email: normalized,
      accessToken,
    });
    if (snapshotRole) {
      saveCachedRole(normalized, snapshotRole);
      return snapshotRole;
    }

    clearCachedRole(normalized);
  } catch {
    const snapshotRole = await resolveSnapshotRoleByEmail({
      email: normalized,
      accessToken,
    });
    if (snapshotRole) {
      saveCachedRole(normalized, snapshotRole);
      return snapshotRole;
    }

    const cached = loadCachedRole(normalized);
    if (cached) return cached;
    return "guest";
  }
  return "guest";
}

export function roleLabel(role: UserRole): string {
  if (role === "admin") return "관리자";
  if (role === "teacher") return "선생님";
  if (role === "student") return "학생";
  return "미등록 계정";
}

export function canAccessRole(role: UserRole, required: RequiredRole): boolean {
  return canAccessRoleByPolicy(role, required);
}
