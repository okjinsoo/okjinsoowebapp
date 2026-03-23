// v1/lib/ui/student/StudentEditBase.tsx
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";

import { useEffect, useState } from "react";
import { useTeachersServerFirst } from "@/lib/hooks/useTeachersServerFirst";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import { readRosterServerFirst } from "@/lib/storage/serverRead";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import StudentEditClient from "@/lib/ui/student/StudentEditClient";

const KEY = "tutorweb_current_student_token";

function loadCurrentStudentToken() {
  if (typeof window === "undefined") return null;
  const v = browserStorage.getItem(KEY);
  return v && v.trim() ? v.trim() : null;
}

export default function StudentEditBase({ role }: { role: "a" | "t" | "s" }) {
  const [token, setToken] = useState<string | null>(null);
  const { teachers, loaded: teachersLoaded } = useTeachersServerFirst();

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (role === "t") {
        if (!teachersLoaded) return;
        const roster = await readRosterServerFirst();
        if (cancelled) return;
        const selection = resolveSelectionForRole({
          role,
          teachers,
          students: roster.students,
          savedTeacherId: null,
          savedStudentToken: loadCurrentStudentToken(),
        });
        setToken(selection.studentToken);
      } else {
        setToken(loadCurrentStudentToken());
      }
    };

    void bootstrap();

    const requestRefresh = () => {
      void bootstrap();
    };

    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
    };
  }, [role, teachers, teachersLoaded]);

  if (role === "s") {
    return (
      <main style={{ padding: 20 }}>
        <h1 className="page-title">학생 정보 수정</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>학생은 정보 편집 권한이 없습니다.</p>
      </main>
    );
  }

  if (!token) {
    return (
      <main style={{ padding: 20 }}>
        <h1 className="page-title">학생 정보 수정</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>학생을 먼저 선택해주세요.</p>
      </main>
    );
  }

  return <StudentEditClient mode="admin" teachers={teachers} token={token} onDoneGoTo={`/${role}/smain`} />;
}
