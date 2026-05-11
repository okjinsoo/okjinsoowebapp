import StudentEditTokenPageClient from "@/lib/ui/student/StudentEditTokenPageClient";
import { buildAdminTeacherStudentHubPath } from "@/lib/routes/appRouteBuilder";

export default async function AdminTeacherStudentEditTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string }>;
}) {
  const { teacherToken, studentToken } = await params;
  const onDoneGoTo = buildAdminTeacherStudentHubPath({
    teacherToken,
    studentToken,
  });
  return (
    <StudentEditTokenPageClient
      mode="admin"
      onDoneGoTo={onDoneGoTo}
      tokenParamName="studentToken"
    />
  );
}
