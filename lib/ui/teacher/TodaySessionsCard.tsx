// lib/ui/teacher/TodaySessionsCard.tsx
"use client";

import { useRouter } from "next/navigation";
import Badge from "@/lib/ui/common/Badge";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import SessionCardRow from "@/lib/ui/session/SessionCardRow";
import {
  buildTeacherSessionCardViewModel,
  type TeacherSessionRow,
} from "@/lib/ui/teacher/teacherSessionCardFactory";

export type TodaySessionRow = TeacherSessionRow;

type Props = {
  rows: TodaySessionRow[];
  role: "a" | "t" | "s";
  title?: string;
  emptyText?: string;
  leadBadgeLabel?: string;
  leadBadgeClassName?: string;
};

export default function TodaySessionsCard({
  rows,
  role,
  title = "오늘의 수업 ",
  emptyText = "오늘 수업이 없습니다.",
  leadBadgeLabel = "D-day",
  leadBadgeClassName = "bg-emerald-600 text-white",
}: Props) {
  const router = useRouter();

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Badge className={leadBadgeClassName}>{leadBadgeLabel}</Badge>
        <div className="card-title">{title}</div>
        <Badge className="bg-slate-200 text-slate-700">{rows.length}개</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted">{emptyText}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => {
            const model = buildTeacherSessionCardViewModel({ row: r, role });
            const handleOpenSession = () => {
              saveCurrentStudentToken(model.token);
              router.push(model.detailHref);
            };

            return (
              <SessionCardRow
                key={model.key}
                model={model.sessionCardModel}
                onClick={handleOpenSession}
                titleColumnWidth={170}
                titleSlot={
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 30,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span>{model.studentName}</span>
                    <span style={{ opacity: 0.7, fontWeight: 600 }}>{model.roundLabel}</span>
                  </div>
                }
                inlineBadgeSlot={
                  model.showLastClassBadge ? (
                    <Badge style={{ background: "#ef4444", color: "#fff" }}>마지막 수업</Badge>
                  ) : null
                }
                rightSlot={<SessionQuickActions role={role} token={model.token} index={model.index} />}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
