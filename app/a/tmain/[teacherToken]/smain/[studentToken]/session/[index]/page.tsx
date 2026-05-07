import Link from "next/link";
import SessionTopBarCore from "@/lib/ui/session/SessionTopBarCore";
import SessionClientCore from "@/lib/ui/session/SessionClientCore";
import AdminTeacherStudentRouteGateCard from "@/lib/ui/common/AdminTeacherStudentRouteGateCard";

export default async function AdminTeacherStudentSessionDetailTokenPage({
  params,
}: {
  params: Promise<{ teacherToken: string; studentToken: string; index: string }>;
}) {
  const { teacherToken, studentToken, index } = await params;
  const sessionIndex = Number(index);
  const studentHubHref = `/a/tmain/${encodeURIComponent(teacherToken)}/smain/${encodeURIComponent(studentToken)}`;

  return (
    <div className="p-6 space-y-4">
      <AdminTeacherStudentRouteGateCard
        teacherToken={teacherToken}
        studentToken={studentToken}
        routeKind="session-detail"
        sessionIndex={sessionIndex}
      />
      <div>
        <Link href={studentHubHref} className="btn btn-bold">
          학생 정보
        </Link>
      </div>
      <SessionClientCore
        role="a"
        token={studentToken}
        sessionIndex={sessionIndex}
        headerSlot={<SessionTopBarCore role="a" token={studentToken} index={sessionIndex} />}
      />
    </div>
  );
}
