import StudentHubCore from "@/lib/ui/student/StudentHubCore";

export default async function AdminStudentHubPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <StudentHubCore role="a" token={token} prefix="/a/students" />;
}
