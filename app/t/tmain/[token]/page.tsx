import StudentHubCore from "@/lib/ui/student/StudentHubCore";
import { buildTmainBasePath } from "@/lib/routes/appRouteBuilder";

export default async function TeacherStudentHubPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <StudentHubCore role="t" token={token} prefix={buildTmainBasePath("t")} />;
}
