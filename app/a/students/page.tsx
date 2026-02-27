"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { hydrateStudentsFromServer } from "@/lib/storage/students";
import {
  hydrateTeachersFromServer,
  saveCurrentTeacherId,
  TEACHERS_EVENT,
} from "@/lib/storage/teachers";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { computeStudentStatus, getStudentStatusMeta, type StudentStatusKind } from "@/lib/factories/studentStatusFactory";
import Badge from "@/lib/ui/common/Badge";
import type { Student, Teacher } from "@/lib/types/index";
import { formatPhone } from "@/lib/utils/phone";

type StudentCard = {
  id: string;
  token: string;
  teacherId?: string | null;
  name: string;
  teacherName: string;
  studentPhone: string;
  parentPhone: string;
  status: StudentStatusKind;
};

function teacherNameOf(teachers: Teacher[], teacherId?: string | null) {
  if (!teacherId) return "(미배정)";
  return teachers.find((t) => t.id === teacherId)?.name ?? "(미배정)";
}

export default function AdminStudentsPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    const refresh = async () => {
      const [nextStudents, nextTeachers] = await Promise.all([
        hydrateStudentsFromServer(),
        hydrateTeachersFromServer(),
      ]);
      setStudents(nextStudents);
      setTeachers(nextTeachers);
    };
    void refresh();
    const id = setTimeout(() => setMounted(true), 0);
    const requestRefresh = () => {
      void refresh();
    };
    window.addEventListener("tutorweb:studentsUpdated", requestRefresh);
    window.addEventListener("tutorweb:sessionsUpdated", requestRefresh);
    window.addEventListener("tutorweb:consultationsUpdated", requestRefresh);
    window.addEventListener(TEACHERS_EVENT, requestRefresh);
    return () => {
      clearTimeout(id);
      window.removeEventListener("tutorweb:studentsUpdated", requestRefresh);
      window.removeEventListener("tutorweb:sessionsUpdated", requestRefresh);
      window.removeEventListener("tutorweb:consultationsUpdated", requestRefresh);
      window.removeEventListener(TEACHERS_EVENT, requestRefresh);
    };
  }, []);

  const cards = useMemo<StudentCard[]>(() => {
    if (!mounted) return [];
    return students
      .filter((s) => !!s.token)
      .map((s) => ({
        id: s.id,
        token: s.token,
        teacherId: s.teacherId ?? null,
        name: s.name ?? "-",
        teacherName: teacherNameOf(teachers, s.teacherId),
        studentPhone: formatPhone(s.studentPhone),
        parentPhone: formatPhone(s.parentPhone),
        status: computeStudentStatus(s),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [mounted, students, teachers]);

  const activeCards = useMemo(
    () => cards.filter((c) => c.status !== "paused" && c.status !== "overdue_extension"),
    [cards]
  );
  const pausedCards = useMemo(
    () => cards.filter((c) => c.status === "paused" || c.status === "overdue_extension"),
    [cards]
  );

  const openStudentMain = (c: StudentCard) => {
    if (c.teacherId) saveCurrentTeacherId(c.teacherId);
    saveCurrentStudentToken(c.token);
    router.push("/a/smain");
  };

  const openStudentEdit = (c: StudentCard) => {
    if (c.teacherId) saveCurrentTeacherId(c.teacherId);
    saveCurrentStudentToken(c.token);
    router.push("/a/smain/edit");
  };

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => router.push("/a/amain")}>
          관리자 페이지
        </button>
      </div>

      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">학생 관리 (원장)</h1>
        <div>
          <button onClick={() => router.push("/a/students/new")} style={{ padding: "8px 12px", fontWeight: 800 }}>
            + 학생 추가
          </button>
        </div>
      </section>

      <section style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
        <div className="card-title">재학생 리스트</div>
        {activeCards.length === 0 ? (
          <div className="text-muted" style={{ marginTop: 8 }}>
            해당 학생이 없습니다.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {activeCards.map((c) => {
              const meta = getStudentStatusMeta(c.status);
              return (
                <div
                  key={`active-${c.id}`}
                  data-student-row="true"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    background: "var(--surface-bg)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={() => openStudentMain(c)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{c.name}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div>{c.teacherName}</div>
                  <div>{c.studentPhone}</div>
                  <div>{c.parentPhone}</div>
                  <div style={{ justifySelf: "end" }}>
                    <button
                      className="btn btn-white"
                      onMouseEnter={(e) => {
                        const row = e.currentTarget.closest("[data-student-row='true']") as HTMLDivElement | null;
                        if (row) row.style.background = "var(--surface-bg)";
                      }}
                      onMouseLeave={(e) => {
                        const row = e.currentTarget.closest("[data-student-row='true']") as HTMLDivElement | null;
                        if (row) row.style.background = "var(--surface-hover)";
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openStudentEdit(c);
                      }}
                    >
                      편집
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
        <div className="card-title">휴회생 리스트</div>
        {pausedCards.length === 0 ? (
          <div className="text-muted" style={{ marginTop: 8 }}>
            해당 학생이 없습니다.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {pausedCards.map((c) => {
              const meta = getStudentStatusMeta(c.status);
              return (
                <div
                  key={`paused-${c.id}`}
                  data-student-row="true"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr 1fr auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    background: "var(--surface-bg)",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={() => openStudentMain(c)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span>{c.name}</span>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <div>{c.teacherName}</div>
                  <div>{c.studentPhone}</div>
                  <div>{c.parentPhone}</div>
                  <div style={{ justifySelf: "end" }}>
                    <button
                      className="btn btn-white"
                      onMouseEnter={(e) => {
                        const row = e.currentTarget.closest("[data-student-row='true']") as HTMLDivElement | null;
                        if (row) row.style.background = "var(--surface-bg)";
                      }}
                      onMouseLeave={(e) => {
                        const row = e.currentTarget.closest("[data-student-row='true']") as HTMLDivElement | null;
                        if (row) row.style.background = "var(--surface-hover)";
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openStudentEdit(c);
                      }}
                    >
                      편집
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
