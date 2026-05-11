import StudentHubCore from "@/lib/ui/student/StudentHubCore";
import AdminTeacherStudentRouteGateCard from "@/lib/ui/common/AdminTeacherStudentRouteGateCard";
import {
  buildAdminTeacherStudentPrefixPath,
  buildAdminTeacherTmainPath,
} from "@/lib/routes/appRouteBuilder";

export default async function AdminTeacherStudentHubTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string }>;
}) {
  const { teacherToken, studentToken } = await params;

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
        prefix={buildAdminTeacherStudentPrefixPath(teacherToken)}
        backToTmainHref={buildAdminTeacherTmainPath(teacherToken)}
      />
    </main>
  );
}
