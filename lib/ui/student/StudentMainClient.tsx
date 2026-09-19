// lib/ui/student/StudentMainClient.tsx
"use client";

import { buildSmainBasePath } from "@/lib/routes/appRouteBuilder";
import StudentHubCore from "@/lib/ui/student/StudentHubCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import useRoleScopedSelection from "@/lib/ui/student/hooks/useRoleScopedSelection";

import { StudentHubSkeleton } from "@/lib/ui/common/AppSkeleton";

export default function StudentMainClient({ role }: { role: "a" | "t" | "s" }) {
  const {
    hydrated,
    students,
    teachers,
    studentToken,
    teacherId,
    setStudentToken,
    setTeacherId,
  } = useRoleScopedSelection({ role });

  if (!hydrated) {
    return <StudentHubSkeleton />;
  }

  return (
    <main>
      <div style={{ padding: 20 }}>
        <RoleGateCard
          role={role}
          teachers={teachers}
          students={students}
          teacherId={teacherId}
          studentToken={studentToken}
          onTeacherChange={(next) => setTeacherId(next)}
          onStudentChange={(next) => setStudentToken(next)}
        />
      </div>

      {!studentToken ? (
        <div style={{ padding: 20 }}>
          <p style={{ color: "var(--text-muted)" }}>학생을 선택해야 페이지를 볼 수 있습니다.</p>
        </div>
      ) : (
        <StudentHubCore role={role} token={studentToken} prefix={buildSmainBasePath(role)} hideTokenInRoute />
      )}
    </main>
  );
}
