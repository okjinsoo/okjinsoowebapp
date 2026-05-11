import StudentSessionListCore from "@/lib/ui/student/StudentSessionListCore";
import { buildTmainBasePath } from "@/lib/routes/appRouteBuilder";

export default async function TeacherStudentSessionListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <StudentSessionListCore role="t" token={token} prefix={buildTmainBasePath("t")} />;
}
