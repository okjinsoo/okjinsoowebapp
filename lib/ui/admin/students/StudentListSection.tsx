"use client";

import { getStudentStatusMeta } from "@/lib/factories/studentStatusFactory";
import Badge from "@/lib/ui/common/Badge";
import type { AdminStudentCard } from "@/lib/ui/admin/students/useAdminStudentsPageData";

type StudentListSectionProps = {
  title: string;
  cards: AdminStudentCard[];
  emptyLabel?: string;
  onOpenStudentMain: (card: AdminStudentCard) => void;
  onOpenStudentEdit: (card: AdminStudentCard) => void;
};

export default function StudentListSection(props: StudentListSectionProps) {
  const {
    title,
    cards,
    emptyLabel = "해당 학생이 없습니다.",
    onOpenStudentMain,
    onOpenStudentEdit,
  } = props;

  return (
    <section style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
      <div className="card-title">{title}</div>
      {cards.length === 0 ? (
        <div className="text-muted" style={{ marginTop: 8 }}>
          {emptyLabel}
        </div>
      ) : (
        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
          {cards.map((card) => {
            const meta = getStudentStatusMeta(card.status);
            return (
              <div
                key={`${title}-${card.id}`}
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
                onClick={() => onOpenStudentMain(card)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{card.name}</span>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
                <div>{card.teacherName}</div>
                <div>{card.studentPhone}</div>
                <div>{card.parentPhone}</div>
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
                      onOpenStudentEdit(card);
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
  );
}
