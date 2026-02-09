import RoleRouteGuard from "@/lib/ui/common/RoleRouteGuard";

export default function TeacherAreaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RoleRouteGuard requiredRole="teacher">{children}</RoleRouteGuard>;
}
