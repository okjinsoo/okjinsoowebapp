"use client";

import { fetchRoleBinding } from "@/lib/auth/roleBindings";
import { browserStorage } from "@/lib/storage/browserStorage";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers } from "@/lib/storage/teachers";

export type UserRole = "guest" | "student" | "teacher" | "admin";
export type RequiredRole = "student" | "teacher" | "admin";

// 요청 반영: 관리자 기본 계정 고정
const FIXED_ADMIN_EMAILS = ["rapah0310@gmail.com"];
const ROLE_CACHE_KEY = "tutorweb_last_roles_v1";
const ROLE_CACHE_TTL_MS = 10 * 60 * 1000;

type RoleCacheMap = Record<string, { role: UserRole; ts: number }>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function resolveLocalRoleByEmail(email: string): UserRole | null {
  if (!email) return null;

  const teachers = loadTeachers();
  if (teachers.some((teacher) => normalizeEmail(teacher.email ?? "") === email)) {
    return "teacher";
  }

  const students = loadStudents();
  if (students.some((student) => normalizeEmail(student.googleEmail ?? "") === email)) {
    return "student";
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

function loadCachedRole(email: string): UserRole | null {
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

  try {
    const role = await fetchRoleBinding({ email: normalized, accessToken });
    if (role === "teacher" || role === "student") {
      saveCachedRole(normalized, role);
      return role;
    }

    // role_bindings 지연 반영 시 로컬 데이터로 1차 보강
    const localRole = resolveLocalRoleByEmail(normalized);
    if (localRole) {
      saveCachedRole(normalized, localRole);
      return localRole;
    }

    clearCachedRole(normalized);
  } catch {
    const localRole = resolveLocalRoleByEmail(normalized);
    if (localRole) {
      saveCachedRole(normalized, localRole);
      return localRole;
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
  if (role === "guest") return false;
  if (required === "student") return true;
  if (required === "teacher") return role === "teacher" || role === "admin";
  return role === "admin";
}
