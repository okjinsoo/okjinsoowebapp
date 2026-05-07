import { redirect } from "next/navigation";

export default async function AdminTeacherPathRedirectPage({
  params,
}: {
  params: Promise<{ teacherToken: string }>;
}) {
  const { teacherToken } = await params;
  redirect(`/a/tmain/${encodeURIComponent(teacherToken)}`);
}
