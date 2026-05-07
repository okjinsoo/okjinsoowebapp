"use client";

import type { Teacher } from "@/lib/types/index";

type TeacherListSectionProps = {
  teachers: Teacher[];
  onOpenTeacherView: (teacher: Teacher) => void;
  onEditTeacher: (teacher: Teacher) => void;
  onRemoveTeacher: (teacher: Teacher) => void;
};

export default function TeacherListSection(props: TeacherListSectionProps) {
  const { teachers, onOpenTeacherView, onEditTeacher, onRemoveTeacher } = props;

  return (
    <section style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
      <h2 className="card-title">선생님 목록</h2>
      <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
        {teachers.map((teacher) => (
          <div key={teacher.id} style={{ border: "1px solid var(--surface-border)", borderRadius: 8, padding: 12, background: "var(--surface-bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap", textAlign: "left" }}>
                <span style={{ fontWeight: 700 }}>{teacher.name}</span>
                <span style={{ color: "var(--text-muted)" }}>{teacher.phone || "-"}</span>
                <span style={{ color: "var(--text-muted)" }}>{teacher.email || "-"}</span>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button
                  onClick={() => onOpenTeacherView(teacher)}
                  style={{ padding: "6px 10px" }}
                  title="선생님 화면으로 이동"
                >
                  선생님 화면
                </button>

                <button
                  className="btn btn-white"
                  onClick={() => onEditTeacher(teacher)}
                >
                  편집
                </button>

                <button className="btn btn-red" onClick={() => onRemoveTeacher(teacher)}>
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}

        {teachers.length === 0 ? <div style={{ color: "var(--text-muted)" }}>아직 선생님이 없습니다.</div> : null}
      </div>
    </section>
  );
}
