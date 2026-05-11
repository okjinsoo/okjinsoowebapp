import { redirect } from "next/navigation";
import { buildAdminTeacherTmainPath } from "@/lib/routes/appRouteBuilder";

export default async function AdminTeacherPathRestRedirectPage({
  params,
}: {
  params: Promise<{ teacherToken: string; rest: string[] }>;
}) {
  const { teacherToken, rest } = await params;
  const suffix = Array.isArray(rest) ? rest.map((part) => encodeURIComponent(part)).join("/") : "";
  redirect(`${buildAdminTeacherTmainPath(teacherToken)}${suffix ? `/${suffix}` : ""}`);
}
