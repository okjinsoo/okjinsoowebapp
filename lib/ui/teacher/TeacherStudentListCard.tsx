// lib/ui/teacher/TeacherStudentListCard.tsx
"use client";

import React from "react";
import Link from "next/link";
import { buildTeacherStudentHubPath, buildTmainBasePath } from "@/lib/routes/appRouteBuilder";
import type { Student } from "@/lib/types/index";
import Badge from "@/lib/ui/common/Badge";
import { formatSchedule } from "@/lib/ui/student/formatters";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { computeStudentStatus, getStudentStatusMeta } from "@/lib/factories/studentStatusFactory";

type Props = {
  students: Student[];
  onStudentClick?: (student: Student) => void;
  studentHrefOf?: (student: Student) => string;
  onAddStudent?: () => void;
  onSyncOwnStudents?: () => void;
  onSyncLearningSheet?: () => void;
  role?: "a" | "t" | "s";
};

export default function TeacherStudentListCard({
  students,
  onStudentClick,
  studentHrefOf,
  onAddStudent,
  onSyncOwnStudents,
  onSyncLearningSheet,
  role = "t",
}: Props) {
  const handleClick = onStudentClick;

  const studentHref = (student: Student) => {
    if (role === "a") {
      return `${buildTmainBasePath("a")}/${encodeURIComponent(student.token)}`;
    }
    if (role === "t") {
      return buildTeacherStudentHubPath({
        role: "t",
        studentToken: student.token,
      });
    }
    return "/s/smain";
  };

  const statusMetaOf = (s: Student) => {
    return getStudentStatusMeta(computeStudentStatus(s));
  };

  const scheduleTextOf = (s: Student) => {
    const changes = s.scheduleChangeEvents ?? [];
    const sorted = [...changes].sort((a, b) => a.startIndex - b.startIndex);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(new Date())
      .reduce(
        (acc, p) => {
          if (p.type === "year") acc.y = p.value;
          if (p.type === "month") acc.m = p.value;
          if (p.type === "day") acc.d = p.value;
          return acc;
        },
        { y: "1970", m: "01", d: "01" }
      );
    const todayYmd = `${today.y}-${today.m}-${today.d}`;

    let rules = [...(s.scheduleRules ?? [])];
    for (const ch of sorted) {
      if (!Array.isArray(ch.newRules) || ch.newRules.length === 0) continue;
      if (ch.startDate && ch.startDate > todayYmd) continue;
      rules = [...ch.newRules];
    }
    return rules.length ? formatSchedule(rules) : "-";
  };

  return (
    <section
      style={{
        marginTop: 14,
        border: "1px solid var(--surface-border)",
        borderRadius: 10,
        padding: 12,
        background: "var(--surface-bg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="card-title">학생 리스트</div>
          <Badge className="bg-slate-200 text-slate-700">{students.length}명</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {onSyncLearningSheet ? (
            <button className="btn btn-blue" onClick={onSyncLearningSheet}>
              학습 현황 동기화
            </button>
          ) : null}
          {onSyncOwnStudents ? (
            <button className="btn btn-blue" onClick={onSyncOwnStudents}>
              본인 학생 회차 동기화
            </button>
          ) : null}
          {onAddStudent ? (
            <button className="btn btn-black" onClick={onAddStudent}>
              + 학생 추가
            </button>
          ) : null}
        </div>
      </div>
      {students.length === 0 ? (
        <div style={{ marginTop: 8, color: "var(--text-muted)" }}>학생이 없습니다.</div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {students.map((s) => {
            const rowStyle: React.CSSProperties = {
              display: "grid",
              gridTemplateColumns: "0.8fr minmax(0, 1.2fr)",
              gap: 6,
              padding: "8px 10px",
              border: "1px solid var(--surface-border)",
              borderRadius: 8,
              background: "var(--surface-bg)",
              cursor: "pointer",
              color: "inherit",
              textDecoration: "none",
            };
            const rowContent = (
              <>
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
              </>
            );

            if (handleClick) {
              return (
                <div
                  key={s.id}
                  style={rowStyle}
                  onClick={() => handleClick(s)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                >
                  {rowContent}
                </div>
              );
            }

            return (
              <Link
                key={s.id}
                href={studentHrefOf ? studentHrefOf(s) : studentHref(s)}
                style={rowStyle}
                onClick={() => saveCurrentStudentToken(s.token)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
              >
                {rowContent}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
