export type UserRole = "guest" | "student" | "teacher" | "admin";
export type RequiredRole = "student" | "teacher" | "admin";

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
  return parseEmailSet(process.env.NEXT_PUBLIC_ADMIN_EMAILS ?? "");
}

export function getTeacherEmailSet(): Set<string> {
  return parseEmailSet(process.env.NEXT_PUBLIC_TEACHER_EMAILS ?? "");
}

export function isRoleConfigReady(): boolean {
  return getAdminEmailSet().size > 0 || getTeacherEmailSet().size > 0;
}

export function getUserRole(email: string | null | undefined): UserRole {
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) return "guest";

  if (getAdminEmailSet().has(normalized)) return "admin";
  if (getTeacherEmailSet().has(normalized)) return "teacher";
  return "student";
}

export function roleLabel(role: UserRole): string {
  if (role === "admin") return "관리자";
  if (role === "teacher") return "선생님";
  if (role === "student") return "학생";
  return "비로그인";
}

export function canAccessRole(role: UserRole, required: RequiredRole): boolean {
  if (role === "guest") return false;
  if (required === "student") return true;
  if (required === "teacher") return role === "teacher" || role === "admin";
  return role === "admin";
}
