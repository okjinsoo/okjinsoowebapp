import { loadStudents } from "@/lib/storage/students";
import { loadTeachers } from "@/lib/storage/teachers";

export type UserRole = "guest" | "student" | "teacher" | "admin";
export type RequiredRole = "student" | "teacher" | "admin";

// 요청 반영: 관리자 기본 계정 고정
const FIXED_ADMIN_EMAILS = ["rapah0310@gmail.com"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseEmailSet(raw: string): Set<string> {
  const set = new Set<string>();
  const parts = raw.split(/[,\n;]+/);
  for (const item of parts) {
    const email = normalizeEmail(item);
    if (!email) continue;
    set.add(email);
  }
  return set;
}

export function getAdminEmailSet(): Set<string> {
  const set = new Set(FIXED_ADMIN_EMAILS.map(normalizeEmail));
  const extra = parseEmailSet(process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "");
  for (const email of extra) set.add(email);
  return set;
}

function isTeacherEmail(email: string): boolean {
  const list = loadTeachers();
  return list.some((t) => normalizeEmail(t.email ?? "") === email);
}

function isStudentEmail(email: string): boolean {
  const list = loadStudents();
  return list.some((s) => normalizeEmail(s.googleEmail ?? "") === email);
}

export function getUserRole(email: string | null | undefined): UserRole {
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) return "guest";

  if (getAdminEmailSet().has(normalized)) return "admin";
  if (isTeacherEmail(normalized)) return "teacher";
  if (isStudentEmail(normalized)) return "student";
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
