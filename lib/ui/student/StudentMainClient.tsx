// lib/ui/student/StudentMainClient.tsx
"use client";

import { useEffect, useState } from "react";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import { pullSharedSnapshotAndHydrate } from "@/lib/storage/sharedSnapshot";
import { loadStudents } from "@/lib/storage/students";
import {
  clearCurrentTeacherId,
  loadTeachers,
  loadCurrentTeacherId,
  saveCurrentTeacherId,
  TEACHERS_EVENT,
} from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";
import StudentHubCore from "@/lib/ui/student/StudentHubCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import {
  clearCurrentStudentToken,
  GATE_EVENT,
  loadCurrentStudentToken,
  saveCurrentStudentToken,
} from "@/lib/ui/common/roleGateStorage";

export default function StudentMainClient({ role }: { role: "a" | "t" | "s" }) {
  const [hydrated, setHydrated] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentToken, setStudentToken] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await pullSharedSnapshotAndHydrate();
      } catch (err) {
        console.error("공유 스냅샷 불러오기 실패(student):", err);
      }

      if (cancelled) return;

      const nextStudents = loadStudents();
      const nextTeachers = loadTeachers();
      setStudents(nextStudents);
      setTeachers(nextTeachers);

      const selection = resolveSelectionForRole({
        role,
        teachers: nextTeachers,
        students: nextStudents,
        savedTeacherId: loadCurrentTeacherId(),
        savedStudentToken: loadCurrentStudentToken(),
      });

      setStudentToken(selection.studentToken);
      setTeacherId(selection.teacherId);

      if (selection.studentToken) saveCurrentStudentToken(selection.studentToken);
      else clearCurrentStudentToken();

      if (selection.teacherId) saveCurrentTeacherId(selection.teacherId);
      else clearCurrentTeacherId();

      setHydrated(true);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    const onGate = async () => {
      try {
        await pullSharedSnapshotAndHydrate();
      } catch (err) {
        console.error("공유 스냅샷 새로고침 실패(student):", err);
      }

      const nextStudents = loadStudents();
      const nextTeachers = loadTeachers();
      setStudents(nextStudents);
      setTeachers(nextTeachers);

      const selection = resolveSelectionForRole({
        role,
        teachers: nextTeachers,
        students: nextStudents,
        savedTeacherId: loadCurrentTeacherId(),
        savedStudentToken: loadCurrentStudentToken(),
      });

      setStudentToken(selection.studentToken);
      setTeacherId(selection.teacherId);

      if (selection.studentToken) saveCurrentStudentToken(selection.studentToken);
      else clearCurrentStudentToken();

      if (selection.teacherId) saveCurrentTeacherId(selection.teacherId);
      else clearCurrentTeacherId();
    };

    const requestGateRefresh = () => {
      void onGate();
    };

    window.addEventListener(GATE_EVENT, requestGateRefresh);
    window.addEventListener(AUTH_EVENT, requestGateRefresh);
    window.addEventListener("tutorweb:studentsUpdated", requestGateRefresh);
    window.addEventListener(TEACHERS_EVENT, requestGateRefresh);
    return () => {
      window.removeEventListener(GATE_EVENT, requestGateRefresh);
      window.removeEventListener(AUTH_EVENT, requestGateRefresh);
      window.removeEventListener("tutorweb:studentsUpdated", requestGateRefresh);
      window.removeEventListener(TEACHERS_EVENT, requestGateRefresh);
    };
  }, [role]);

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
