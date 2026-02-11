// v1/lib/ui/student/StudentEditBase.tsx
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";

import { useEffect, useState } from "react";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import { pullSharedSnapshotAndHydrate } from "@/lib/storage/sharedSnapshot";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers } from "@/lib/storage/teachers";
import type { Teacher } from "@/lib/types/index";
import StudentEditClient from "@/lib/ui/student/StudentEditClient";

const KEY = "tutorweb_current_student_token";

function loadCurrentStudentToken() {
  if (typeof window === "undefined") return null;
  const v = browserStorage.getItem(KEY);
  return v && v.trim() ? v.trim() : null;
}

export default function StudentEditBase({ role }: { role: "a" | "t" | "s" }) {
  const [token, setToken] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await pullSharedSnapshotAndHydrate();
      } catch (err) {
        console.error("공유 스냅샷 불러오기 실패(student edit):", err);
      }
      if (cancelled) return;

      const nextTeachers = loadTeachers();
      setTeachers(nextTeachers);

      if (role === "t") {
        const selection = resolveSelectionForRole({
          role,
          teachers: nextTeachers,
          students: loadStudents(),
          savedTeacherId: null,
          savedStudentToken: loadCurrentStudentToken(),
        });
        setToken(selection.studentToken);
      } else {
        setToken(loadCurrentStudentToken());
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (role === "s") {
    return (
      <main style={{ padding: 20 }}>
        <h1 className="page-title">학생 정보 수정</h1>
        <p style={{ marginTop: 8, color: "#666" }}>학생은 정보 편집 권한이 없습니다.</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main style={{ padding: 20 }}>
        <h1 className="page-title">학생 정보 수정</h1>
        <p style={{ marginTop: 8, color: "#666" }}>학생을 먼저 선택해주세요.</p>
      </main>
    );
  }

  return <StudentEditClient mode="admin" teachers={teachers} token={token} onDoneGoTo={`/${role}/smain`} />;
}
