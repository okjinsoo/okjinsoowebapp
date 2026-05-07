import { redirect } from "next/navigation";

export default async function AdminTeacherPathRestRedirectPage({
  params,
}: {
  params: Promise<{ teacherToken: string; rest: string[] }>;
}) {
  const { teacherToken, rest } = await params;
  const suffix = Array.isArray(rest) ? rest.map((part) => encodeURIComponent(part)).join("/") : "";
  redirect(`/a/tmain/${encodeURIComponent(teacherToken)}${suffix ? `/${suffix}` : ""}`);
}
