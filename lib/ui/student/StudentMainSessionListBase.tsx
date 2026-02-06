// v1/lib/ui/student/StudentMainSessionListBase.tsx
"use client";

import { useEffect, useState } from "react";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers, loadCurrentTeacherId } from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";
import StudentSessionListCore from "@/lib/ui/student/StudentSessionListCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import { GATE_EVENT, loadCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";

export default function StudentMainSessionListBase({ role }: { role: "a" | "t" | "s" }) {
  const [token, setToken] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setToken(loadCurrentStudentToken());
      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setTeacherId(loadCurrentTeacherId());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onGate = () => {
      setToken(loadCurrentStudentToken());
      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setTeacherId(loadCurrentTeacherId());
    };
    window.addEventListener(GATE_EVENT, onGate);
    window.addEventListener("tutorweb:studentsUpdated", onGate);
    return () => {
      window.removeEventListener(GATE_EVENT, onGate);
      window.removeEventListener("tutorweb:studentsUpdated", onGate);
    };
  }, []);

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
        <button onClick={() => (window.location.href = `/${role}/smain`)} className="btn btn-bold">
          학생 정보
        </button>
      </div>
      {token ? (
        <StudentSessionListCore role={role} token={token} prefix={`/${role}/smain`} hideTokenInRoute />
      ) : (
        <div style={{ padding: 20, color: "#666" }}>먼저 학생을 선택해주세요.</div>
      )}
    </main>
  );
}
