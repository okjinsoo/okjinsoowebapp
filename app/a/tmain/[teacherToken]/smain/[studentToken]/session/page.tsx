import Link from "next/link";
import {
  buildAdminTeacherStudentHubPath,
  buildAdminTeacherStudentPrefixPath,
} from "@/lib/routes/appRouteBuilder";
import StudentSessionListCore from "@/lib/ui/student/StudentSessionListCore";
import AdminTeacherStudentRouteGateCard from "@/lib/ui/common/AdminTeacherStudentRouteGateCard";

export default async function AdminTeacherStudentSessionListTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string }>;
}) {
  const { teacherToken, studentToken } = await params;
  const hubHref = buildAdminTeacherStudentHubPath({
    teacherToken,
    studentToken,
  });

  return (
    <main>
      <div style={{ padding: 20 }}>
        <AdminTeacherStudentRouteGateCard
          teacherToken={teacherToken}
          studentToken={studentToken}
          routeKind="session-list"
        />
      </div>
      <div style={{ padding: "0 20px 10px" }}>
        <Link href={hubHref} className="btn btn-bold">
          학생 정보
        </Link>
      </div>
      <StudentSessionListCore
        role="a"
        token={studentToken}
        prefix={buildAdminTeacherStudentPrefixPath(teacherToken)}
      />
    </main>
  );
}
