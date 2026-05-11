import { redirect } from "next/navigation";
import { buildAdminTeacherTmainPath } from "@/lib/routes/appRouteBuilder";

export default async function AdminTeacherPathRedirectPage({
  params,
}: {
  params: Promise<{ teacherToken: string }>;
}) {
  const { teacherToken } = await params;
  redirect(buildAdminTeacherTmainPath(teacherToken));
}
