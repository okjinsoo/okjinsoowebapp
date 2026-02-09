import { fetchRoleBinding } from "@/lib/auth/roleBindings";

export type UserRole = "guest" | "student" | "teacher" | "admin";
export type RequiredRole = "student" | "teacher" | "admin";

// 요청 반영: 관리자 기본 계정 고정
const FIXED_ADMIN_EMAILS = ["rapah0310@gmail.com"];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getAdminEmailSet(): Set<string> {
  return new Set(FIXED_ADMIN_EMAILS.map(normalizeEmail));
}

export async function resolveUserRole(args: {
  email: string | null | undefined;
  accessToken: string | null | undefined;
}): Promise<UserRole> {
  const { email, accessToken } = args;
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) return "guest";

  if (getAdminEmailSet().has(normalized)) return "admin";
  if (!accessToken) return "guest";

  try {
    const role = await fetchRoleBinding({ email: normalized, accessToken });
    if (role === "teacher" || role === "student") {
      return role;
    }
  } catch {
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
