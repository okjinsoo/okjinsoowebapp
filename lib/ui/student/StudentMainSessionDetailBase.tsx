// v1/lib/ui/student/StudentMainSessionDetailBase.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers, loadCurrentTeacherId } from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";
import SessionTopBarCore from "@/lib/ui/session/SessionTopBarCore";
import SessionClientCore from "@/lib/ui/session/SessionClientCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import { GATE_EVENT, loadCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";

export default function StudentMainSessionDetailBase({ role }: { role: "a" | "t" | "s" }) {
  const params = useParams();
  const router = useRouter();
  const index = Number(params?.index ?? 0);
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
