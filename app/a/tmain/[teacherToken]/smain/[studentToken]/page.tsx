import { redirect } from "next/navigation";
import StudentHubCore from "@/lib/ui/student/StudentHubCore";
import AdminTeacherStudentRouteGateCard from "@/lib/ui/common/AdminTeacherStudentRouteGateCard";
import { resolveTeacherTokenByStudentToken } from "@/lib/server/adminTmainRoutes";

export default async function AdminTeacherStudentHubTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string }>;
}) {
  const { teacherToken, studentToken } = await params;
  const canonicalTeacherToken = await resolveTeacherTokenByStudentToken(studentToken);
  if (canonicalTeacherToken && canonicalTeacherToken !== teacherToken) {
    redirect(
      `/a/tmain/${encodeURIComponent(canonicalTeacherToken)}/smain/${encodeURIComponent(studentToken)}`
    );
  }
  const encodedTeacherToken = encodeURIComponent(teacherToken);

  return (
    <main>
      <div style={{ padding: 20 }}>
        <AdminTeacherStudentRouteGateCard
          teacherToken={teacherToken}
          studentToken={studentToken}
          routeKind="hub"
        />
      </div>
      <StudentHubCore
        role="a"
        token={studentToken}
        prefix={`/a/tmain/${encodedTeacherToken}/smain`}
        backToTmainHref={`/a/tmain/${encodedTeacherToken}`}
      />
    </main>
  );
}
