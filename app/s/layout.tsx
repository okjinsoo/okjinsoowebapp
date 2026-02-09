import RoleRouteGuard from "@/lib/ui/common/RoleRouteGuard";

export default function StudentAreaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RoleRouteGuard requiredRole="student">{children}</RoleRouteGuard>;
}
