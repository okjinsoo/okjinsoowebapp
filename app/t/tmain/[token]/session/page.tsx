import StudentSessionListCore from "@/lib/ui/student/StudentSessionListCore";

export default async function TeacherStudentSessionListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <StudentSessionListCore role="t" token={token} prefix="/t/tmain" />;
}
