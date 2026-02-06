// v1/app/a/teachers/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Teacher, Student } from "@/lib/types/index";
import { loadTeachers, removeTeacher, saveCurrentTeacherId, TEACHERS_EVENT } from "@/lib/storage/teachers";
import { loadStudents, saveStudents } from "@/lib/storage/students";

export default function AdminTeachersPage() {
  const router = useRouter();
  const [teachers, setTeachers] = useState<Teacher[]>(() => loadTeachers());

  useEffect(() => {
    const id = setTimeout(() => setTeachers(loadTeachers()), 0);
    const refresh = () => setTeachers(loadTeachers());
    window.addEventListener(TEACHERS_EVENT, refresh);
    return () => {
      clearTimeout(id);
      window.removeEventListener(TEACHERS_EVENT, refresh);
    };
  }, []);

  const teacherLinks = useMemo(() => {
    return teachers.map((t) => ({
      ...t,
      teacherView: `/a/tmain`,
    }));
  }, [teachers]);

  /**
   * ✅ 핵심 변경점:
   * 선생님 삭제 시, 그 선생님에게 배정된 학생들은 teacherId를 null로 바꿔 "미배정"으로 만든다.
   */
  function onRemove(teacherId: string) {
    const allStudents = loadStudents();
    const assigned = allStudents.filter((s: Student) => (s.teacherId ?? null) === teacherId);

    const msg =
      assigned.length > 0
        ? `정말 삭제할까요?\n\n- 이 선생님에게 배정된 학생 ${assigned.length}명은 자동으로 "미배정" 처리됩니다.`
        : "정말 삭제할까요?";

    if (!confirm(msg)) return;

    // 1) 학생 미배정 처리
    if (assigned.length > 0) {
      const nextStudents = allStudents.map((s: Student) => {
        if ((s.teacherId ?? null) !== teacherId) return s;
        return { ...s, teacherId: null };
      });
      saveStudents(nextStudents);
    }

    // 2) 선생님 삭제
    const nextTeachers = removeTeacher(teacherId);
    setTeachers(nextTeachers);
  }

  return (
    <main style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => router.push("/a/amain")}>
          관리자 페이지
        </button>
      </div>

      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">선생님 관리 (원장)</h1>
        <div>
          <button className="btn btn-bold" onClick={() => router.push("/a/teachers/new")}>
            + 선생님 추가
          </button>
        </div>
      </section>

      <section style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, padding: 14, background: "#fff" }}>
        <h2 className="card-title">선생님 목록</h2>
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          {teacherLinks.map((t) => (
            <div key={t.id} style={{ border: "1px solid #eee", borderRadius: 8, padding: 12, background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", textAlign: "left" }}>
                  <span style={{ fontWeight: 700 }}>{t.name}</span>
                  <span style={{ color: "#666" }}>{t.phone || "-"}</span>
                  <span style={{ color: "#666" }}>{t.email || "-"}</span>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button
                    onClick={() => router.push(t.teacherView)}
                    style={{ padding: "6px 10px" }}
                    title="선생님 화면으로 이동"
                  >
                    선생님 화면
                  </button>

                  <button
                    className="btn btn-white"
                    onClick={() => {
                      saveCurrentTeacherId(t.id);
                      router.push("/a/teachers/edit");
                    }}
                  >
                    편집
                  </button>

                  <button className="btn btn-red" onClick={() => onRemove(t.id)}>
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))}

          {teachers.length === 0 ? <div style={{ color: "#666" }}>아직 선생님이 없습니다.</div> : null}
        </div>
      </section>
    </main>
  );
}
