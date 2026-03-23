// app/t/tmain/new/TeacherStudentNewPageClient.tsx
"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { findTeacherByLoginEmail } from "@/lib/auth/loginSelection";
import { useTeachersServerFirst } from "@/lib/hooks/useTeachersServerFirst";
import {
  saveCurrentTeacherId,
  loadCurrentTeacherId,
} from "@/lib/storage/teachers";
import StudentNewClient from "@/lib/ui/student/StudentNewClient";

export default function TeacherStudentNewPageClient({ basePath = "/t/tmain" }: { basePath?: string }) {
  const router = useRouter();

  const { teachers, loaded } = useTeachersServerFirst();
  const matchedTeacherId = useMemo(() => {
    if (!loaded) return null;
    return findTeacherByLoginEmail(teachers)?.id ?? null;
  }, [loaded, teachers]);

  useEffect(() => {
    if (!matchedTeacherId) return;
    saveCurrentTeacherId(matchedTeacherId);
  }, [matchedTeacherId]);

  const teacherId = useMemo(() => {
    if (!loaded) return null;
    return matchedTeacherId ?? loadCurrentTeacherId();
  }, [loaded, matchedTeacherId]);

  const teacherName = useMemo(() => {
    if (!teacherId) return "";
    return teachers.find((t) => t.id === teacherId)?.name ?? "";
  }, [teachers, teacherId]);

  if (!loaded) {
    return (
      <main className="p-6" style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 className="page-title">신규 학생 등록 (선생님)</h1>
        <p className="mt-2 text-sm opacity-70">로딩 중...</p>
      </main>
    );
  }

  if (!teacherId) {
    return (
      <main className="p-6" style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 className="page-title">신규 학생 등록 (선생님)</h1>
        <p className="mt-2 text-sm opacity-70">선생님이 선택되지 않았습니다. 먼저 선생님을 선택해주세요.</p>
        <button
          className="mt-4 px-3 py-2 rounded bg-black text-white"
          onClick={() => router.push(basePath)}
        >
          선생님 선택으로 이동
        </button>
      </main>
    );
  }

  return (
    <main className="p-6" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="mb-3 text-sm opacity-70">
        현재 선생님: <b>{teacherName || teacherId}</b>
      </div>

      <StudentNewClient
        mode="teacher"
        teachers={teachers}
        fixedTeacherId={teacherId}
        onDoneGoTo={basePath}
      />
    </main>
  );
}
