// lib/ui/teacher/TeacherStudentListCard.tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import type { Student } from "@/lib/types/index";
import Badge from "@/lib/ui/common/Badge";
import { formatSchedule } from "@/lib/ui/student/formatters";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { computeStudentStatus, getStudentStatusMeta } from "@/lib/factories/studentStatusFactory";

type Props = {
  students: Student[];
  onStudentClick?: (student: Student) => void;
  onAddStudent?: () => void;
  role?: "a" | "t" | "s";
};

export default function TeacherStudentListCard({ students, onStudentClick, onAddStudent, role = "t" }: Props) {
  const router = useRouter();
  const handleClick =
    onStudentClick ??
    ((s: Student) => {
      saveCurrentStudentToken(s.token);
      router.push(`/${role}/smain`);
    });

  const statusMetaOf = (s: Student) => {
    return getStudentStatusMeta(computeStudentStatus(s));
  };

  const scheduleTextOf = (s: Student) => {
    const changes = s.scheduleChangeEvents ?? [];
    if (changes.length > 0) {
      const sorted = [...changes].sort((a, b) => a.startIndex - b.startIndex);
      const last = sorted[sorted.length - 1];
      if (last?.newRules?.length) return formatSchedule(last.newRules);
    }
    return formatSchedule(s.scheduleRules ?? []);
  };

  return (
    <section
      style={{
        marginTop: 14,
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 12,
        background: "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="card-title">학생 리스트</div>
          <Badge className="bg-slate-200 text-slate-700">{students.length}명</Badge>
        </div>
        {onAddStudent ? (
          <button className="btn btn-black" onClick={onAddStudent}>
            + 학생 추가
          </button>
        ) : null}
      </div>
      {students.length === 0 ? (
        <div style={{ marginTop: 8, color: "#666" }}>학생이 없습니다.</div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {students.map((s) => (
            <div
              key={s.id}
              style={{
                display: "grid",
                gridTemplateColumns: "0.8fr minmax(0, 1.2fr)",
                gap: 6,
                padding: "8px 10px",
                border: "1px solid #eee",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
              }}
              onClick={() => handleClick(s)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>
                  {s.cohort ?? "-"} · <span style={{ fontWeight: 700 }}>{s.name}</span>
                </span>
                {(() => {
                  const meta = statusMetaOf(s);
                  return <Badge tone={meta.tone}>{meta.label}</Badge>;
                })()}
              </div>
              <div style={{ textAlign: "left" }}>{scheduleTextOf(s) || "-"}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
