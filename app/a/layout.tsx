import RoleRouteGuard from "@/lib/ui/common/RoleRouteGuard";

export default function AdminAreaLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <RoleRouteGuard requiredRole="admin">{children}</RoleRouteGuard>;
}
