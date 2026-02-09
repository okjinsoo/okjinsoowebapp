// app/t/tmain/new/TeacherStudentNewPageClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Teacher } from "@/lib/types/index";
import { findTeacherByLoginEmail } from "@/lib/auth/loginSelection";
import { pullSharedSnapshotAndHydrate } from "@/lib/storage/sharedSnapshot";
import {
  loadTeachers,
  saveCurrentTeacherId,
  loadCurrentTeacherId,
} from "@/lib/storage/teachers";
import StudentNewClient from "@/lib/ui/student/StudentNewClient";

export default function TeacherStudentNewPageClient({ basePath = "/t/tmain" }: { basePath?: string }) {
  const router = useRouter();

  const [teachers, setTeachers] = useState<Teacher[]>(() => loadTeachers());
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await pullSharedSnapshotAndHydrate();
      } catch (err) {
        console.error("공유 스냅샷 불러오기 실패(teacher new):", err);
      }
      if (cancelled) return;

      const nextTeachers = loadTeachers();
      setTeachers(nextTeachers);

      const matchedTeacherId = findTeacherByLoginEmail(nextTeachers)?.id ?? null;
      if (matchedTeacherId) {
        saveCurrentTeacherId(matchedTeacherId);
        setTeacherId(matchedTeacherId);
      } else {
        setTeacherId(loadCurrentTeacherId());
      }
      setHydrated(true);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const teacherName = useMemo(() => {
    if (!teacherId) return "";
    return teachers.find((t) => t.id === teacherId)?.name ?? "";
  }, [teachers, teacherId]);

  if (!hydrated) {
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
