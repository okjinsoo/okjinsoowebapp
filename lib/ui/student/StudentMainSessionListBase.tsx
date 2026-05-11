// v1/lib/ui/student/StudentMainSessionListBase.tsx
"use client";

import { buildSmainBasePath } from "@/lib/routes/appRouteBuilder";
import StudentSessionListCore from "@/lib/ui/student/StudentSessionListCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import useRoleScopedSelection from "@/lib/ui/student/hooks/useRoleScopedSelection";

export default function StudentMainSessionListBase({ role }: { role: "a" | "t" | "s" }) {
  const {
    studentToken: token,
    students,
    teachers,
    teacherId,
    setStudentToken: setToken,
    setTeacherId,
  } = useRoleScopedSelection({ role });
  const basePath = buildSmainBasePath(role);

  return (
    <main>
      <div style={{ padding: 20 }}>
        <RoleGateCard
          role={role}
          teachers={teachers}
          students={students}
          teacherId={teacherId}
          studentToken={token}
          onTeacherChange={(next) => setTeacherId(next)}
          onStudentChange={(next) => setToken(next)}
        />
      </div>

      <div style={{ padding: "0 20px 10px" }}>
        <button onClick={() => (window.location.href = basePath)} className="btn btn-bold">
          학생 정보
        </button>
      </div>
      {token ? (
        <StudentSessionListCore role={role} token={token} prefix={basePath} hideTokenInRoute />
      ) : (
        <div style={{ padding: 20, color: "var(--text-muted)" }}>먼저 학생을 선택해주세요.</div>
      )}
    </main>
  );
}
