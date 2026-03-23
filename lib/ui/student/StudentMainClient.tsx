// lib/ui/student/StudentMainClient.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import {
  clearCurrentTeacherId,
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
import { readRosterServerFirst } from "@/lib/storage/serverRead";

export default function StudentMainClient({ role }: { role: "a" | "t" | "s" }) {
  const [hydrated, setHydrated] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentToken, setStudentToken] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  const applySelection = useCallback((nextStudents: Student[], nextTeachers: Teacher[]) => {
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
  }, [role]);

  useEffect(() => {
    let cancelled = false;

    const refreshRoster = async () => {
      const next = await readRosterServerFirst();
      if (cancelled) return;
      setStudents(next.students);
      setTeachers(next.teachers);
      applySelection(next.students, next.teachers);
      setHydrated(true);
    };

    void refreshRoster();
    return () => {
      cancelled = true;
    };
  }, [applySelection]);

  useEffect(() => {
    let cancelled = false;

    const refreshRoster = async () => {
      const next = await readRosterServerFirst();
      if (cancelled) return;
      setStudents(next.students);
      setTeachers(next.teachers);
      applySelection(next.students, next.teachers);
    };

    const requestGateRefresh = () => {
      void refreshRoster();
    };

    window.addEventListener(GATE_EVENT, requestGateRefresh);
    window.addEventListener(AUTH_EVENT, requestGateRefresh);
    window.addEventListener("tutorweb:studentsUpdated", requestGateRefresh);
    window.addEventListener(TEACHERS_EVENT, requestGateRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(GATE_EVENT, requestGateRefresh);
      window.removeEventListener(AUTH_EVENT, requestGateRefresh);
      window.removeEventListener("tutorweb:studentsUpdated", requestGateRefresh);
      window.removeEventListener(TEACHERS_EVENT, requestGateRefresh);
    };
  }, [applySelection]);

  if (!hydrated) {
    return (
      <main style={{ padding: 20 }}>
        <h1 className="page-title">학생 화면</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>로딩 중...</p>
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
          <p style={{ color: "var(--text-muted)" }}>학생을 선택해야 페이지를 볼 수 있습니다.</p>
        </div>
      ) : (
        <StudentHubCore role={role} token={studentToken} prefix={`/${role}/smain`} hideTokenInRoute />
      )}
    </main>
  );
}
