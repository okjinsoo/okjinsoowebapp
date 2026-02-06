import StudentSessionListCore from "@/lib/ui/student/StudentSessionListCore";

export default async function AdminStudentSessionListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <StudentSessionListCore role="a" token={token} prefix="/a/students" />;
}
