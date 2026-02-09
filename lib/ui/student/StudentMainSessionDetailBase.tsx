// v1/lib/ui/student/StudentMainSessionDetailBase.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import { pullSharedSnapshotAndHydrate } from "@/lib/storage/sharedSnapshot";
import { loadStudents } from "@/lib/storage/students";
import {
  clearCurrentTeacherId,
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

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (role !== "a") {
        try {
          await pullSharedSnapshotAndHydrate();
        } catch (err) {
          console.error("공유 스냅샷 불러오기 실패(student session detail):", err);
        }
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

      setToken(selection.studentToken);
      setTeacherId(selection.teacherId);

      if (selection.studentToken) saveCurrentStudentToken(selection.studentToken);
      else clearCurrentStudentToken();

      if (selection.teacherId) saveCurrentTeacherId(selection.teacherId);
      else clearCurrentTeacherId();
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [role]);

  useEffect(() => {
    const onGate = async () => {
      if (role !== "a") {
        try {
          await pullSharedSnapshotAndHydrate();
        } catch (err) {
          console.error("공유 스냅샷 새로고침 실패(student session detail):", err);
        }
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

      setToken(selection.studentToken);
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
    window.addEventListener("tutorweb:teachersUpdated", requestGateRefresh);
    return () => {
      window.removeEventListener(GATE_EVENT, requestGateRefresh);
      window.removeEventListener(AUTH_EVENT, requestGateRefresh);
      window.removeEventListener("tutorweb:studentsUpdated", requestGateRefresh);
      window.removeEventListener("tutorweb:teachersUpdated", requestGateRefresh);
    };
  }, [role]);

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
          <div style={{ color: "#666" }}>학생을 먼저 선택해주세요.</div>
        )}
      </div>
    </main>
  );
}
