export type AccessRole = "guest" | "student" | "teacher" | "admin";
export type RequiredRole = "student" | "teacher" | "admin";

export function canAccessRole(role: AccessRole, required: RequiredRole): boolean {
  if (role === "guest") return false;
  if (required === "student") return true;
  if (required === "teacher") return role === "teacher" || role === "admin";
  return role === "admin";
}

export function requiredRoleByPathname(pathname: string): RequiredRole | null {
  if (pathname.startsWith("/a")) return "admin";
  if (pathname.startsWith("/t")) return "teacher";
  if (pathname.startsWith("/s")) return "student";
  return null;
}
