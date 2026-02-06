// v1/lib/ui/student/StudentEditBase.tsx
"use client";

import { useEffect, useState } from "react";
import { loadTeachers } from "@/lib/storage/teachers";
import type { Teacher } from "@/lib/types/index";
import StudentEditClient from "@/lib/ui/student/StudentEditClient";

const KEY = "tutorweb_current_student_token";

function loadCurrentStudentToken() {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(KEY);
  return v && v.trim() ? v.trim() : null;
}

export default function StudentEditBase({ role }: { role: "a" | "t" | "s" }) {
  const [token, setToken] = useState<string | null>(null);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      setToken(loadCurrentStudentToken());
      setTeachers(loadTeachers());
    }, 0);
    return () => clearTimeout(id);
  }, []);

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
