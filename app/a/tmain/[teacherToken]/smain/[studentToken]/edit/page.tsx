import { redirect } from "next/navigation";
import StudentEditTokenPageClient from "@/lib/ui/student/StudentEditTokenPageClient";
import { resolveTeacherTokenByStudentToken } from "@/lib/server/adminTmainRoutes";

export default async function AdminTeacherStudentEditTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string }>;
}) {
  const { teacherToken, studentToken } = await params;
  const canonicalTeacherToken = await resolveTeacherTokenByStudentToken(studentToken);
  if (canonicalTeacherToken && canonicalTeacherToken !== teacherToken) {
    redirect(
      `/a/tmain/${encodeURIComponent(canonicalTeacherToken)}/smain/${encodeURIComponent(studentToken)}/edit`
    );
  }
  const onDoneGoTo = `/a/tmain/${encodeURIComponent(teacherToken)}/smain/${encodeURIComponent(studentToken)}`;
  return (
    <StudentEditTokenPageClient
      mode="admin"
      onDoneGoTo={onDoneGoTo}
      tokenParamName="studentToken"
    />
  );
}
