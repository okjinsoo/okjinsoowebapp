// lib/ui/student/StudentMainClient.tsx
"use client";

import { useEffect, useState } from "react";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers, loadCurrentTeacherId, TEACHERS_EVENT } from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";
import StudentHubCore from "@/lib/ui/student/StudentHubCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import { GATE_EVENT, loadCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";

export default function StudentMainClient({ role }: { role: "a" | "t" | "s" }) {
  const [hydrated, setHydrated] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentToken, setStudentToken] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setStudentToken(loadCurrentStudentToken());
      setTeacherId(loadCurrentTeacherId());
      setHydrated(true);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onGate = () => {
      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setStudentToken(loadCurrentStudentToken());
      setTeacherId(loadCurrentTeacherId());
    };
    window.addEventListener(GATE_EVENT, onGate);
    window.addEventListener("tutorweb:studentsUpdated", onGate);
    window.addEventListener(TEACHERS_EVENT, onGate);
    return () => {
      window.removeEventListener(GATE_EVENT, onGate);
      window.removeEventListener("tutorweb:studentsUpdated", onGate);
      window.removeEventListener(TEACHERS_EVENT, onGate);
    };
  }, []);

  if (!hydrated) {
    return (
      <main style={{ padding: 20 }}>
        <h1 className="page-title">학생 화면</h1>
        <p style={{ marginTop: 8, color: "#666" }}>로딩 중...</p>
      </main>
    );
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
          <p style={{ color: "#666" }}>학생을 선택해야 페이지를 볼 수 있습니다.</p>
        </div>
      ) : (
        <StudentHubCore role={role} token={studentToken} prefix={`/${role}/smain`} hideTokenInRoute />
      )}
    </main>
  );
}
