import StudentEditTokenPageClient from "@/lib/ui/student/StudentEditTokenPageClient";

export default async function AdminTeacherStudentEditTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string }>;
}) {
  const { teacherToken, studentToken } = await params;
  const onDoneGoTo = `/a/tmain/${encodeURIComponent(teacherToken)}/smain/${encodeURIComponent(studentToken)}`;
  return (
    <StudentEditTokenPageClient
      mode="admin"
      onDoneGoTo={onDoneGoTo}
      tokenParamName="studentToken"
    />
  );
}
