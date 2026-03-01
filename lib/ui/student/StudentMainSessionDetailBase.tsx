// v1/lib/ui/student/StudentMainSessionDetailBase.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import { hydrateStudentsFromServer, loadStudents } from "@/lib/storage/students";
import { hydrateConsultationsByStudentFromServer } from "@/lib/storage/consultations";
import { hydrateSessionsForStudentFromServer } from "@/lib/storage/sessions";
import {
  clearCurrentTeacherId,
  hydrateTeachersFromServer,
  loadTeachers,
  loadCurrentTeacherId,
  saveCurrentTeacherId,
} from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";
import SessionTopBarCore from "@/lib/ui/session/SessionTopBarCore";
import SessionClientCore from "@/lib/ui/session/SessionClientCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import {
  clearCurrentStudentToken,
  GATE_EVENT,
  loadCurrentStudentToken,
  saveCurrentStudentToken,
} from "@/lib/ui/common/roleGateStorage";

export default function StudentMainSessionDetailBase({ role }: { role: "a" | "t" | "s" }) {
  const params = useParams();
  const router = useRouter();
  const index = Number(params?.index ?? 0);
  const [token, setToken] = useState<string | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  const applySelection = useCallback((nextStudents: Student[], nextTeachers: Teacher[]) => {
    const selection = resolveSelectionForRole({
      role,
      teachers: nextTeachers,
      students: nextStudents,
      savedTeacherId: loadCurrentTeacherId(),
      savedStudentToken: loadCurrentStudentToken(),
    });

    setToken(selection.studentToken);
    setTeacherId(selection.teacherId);

    const selectedStudent = nextStudents.find((student) => student.token === selection.studentToken);
    if (selectedStudent) {
      void hydrateSessionsForStudentFromServer(selectedStudent.id);
      void hydrateConsultationsByStudentFromServer(selectedStudent.id);
    }

    if (selection.studentToken) saveCurrentStudentToken(selection.studentToken);
    else clearCurrentStudentToken();

    if (selection.teacherId) saveCurrentTeacherId(selection.teacherId);
    else clearCurrentTeacherId();
  }, [role]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      const localStudents = loadStudents();
      const localTeachers = loadTeachers();
      if (!cancelled) {
        setStudents(localStudents);
        setTeachers(localTeachers);
        applySelection(localStudents, localTeachers);
      }

      const [nextStudents, nextTeachers] = await Promise.all([
        hydrateStudentsFromServer(),
        hydrateTeachersFromServer(),
      ]);
      if (cancelled) return;
      setStudents(nextStudents);
      setTeachers(nextTeachers);
      applySelection(nextStudents, nextTeachers);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applySelection]);

  useEffect(() => {
    const onGate = async () => {
      const localStudents = loadStudents();
      const localTeachers = loadTeachers();
      setStudents(localStudents);
      setTeachers(localTeachers);
      applySelection(localStudents, localTeachers);

      const [nextStudents, nextTeachers] = await Promise.all([
        hydrateStudentsFromServer(),
        hydrateTeachersFromServer(),
      ]);
      setStudents(nextStudents);
      setTeachers(nextTeachers);
      applySelection(nextStudents, nextTeachers);
    };

    const requestGateRefresh = () => {
      void onGate();
    };

    window.addEventListener(GATE_EVENT, requestGateRefresh);
    window.addEventListener(AUTH_EVENT, requestGateRefresh);
    window.addEventListener("tutorweb:studentsUpdated", requestGateRefresh);
    window.addEventListener("tutorweb:teachersUpdated", requestGateRefresh);
    return () => {
      window.removeEventListener(GATE_EVENT, requestGateRefresh);
      window.removeEventListener(AUTH_EVENT, requestGateRefresh);
      window.removeEventListener("tutorweb:studentsUpdated", requestGateRefresh);
      window.removeEventListener("tutorweb:teachersUpdated", requestGateRefresh);
    };
  }, [applySelection]);

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
          onStudentChange={(next) => {
            setToken(next);
            if (Number.isFinite(index)) {
              router.push(`/${role}/smain/session/${index}`);
            }
          }}
        />
      </div>

      <div className="p-6 space-y-4">
        <div>
          <button onClick={() => router.push(`/${role}/smain`)} className="btn btn-bold">
            학생 정보
          </button>
        </div>
        {token && Number.isFinite(index) ? (
          <SessionClientCore
            role={role}
            token={token}
            sessionIndex={index}
            headerSlot={<SessionTopBarCore role={role} token={token} index={index} />}
          />
        ) : (
          <div style={{ color: "var(--text-muted)" }}>학생을 먼저 선택해주세요.</div>
        )}
      </div>
    </main>
  );
}
