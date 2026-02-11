// lib/ui/teacher/TodaySessionsCard.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import Badge from "@/lib/ui/common/Badge";
import { getStatusStyle } from "@/lib/factories/sessionFactories";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import { saveConsultationsByStudent, loadConsultationsByStudent } from "@/lib/storage/consultations";
import { loadStudents, upsertStudent } from "@/lib/storage/students";
import { buildConsultationRecord, validateConsultForm } from "@/lib/factories/consultationFactory";
import { computePauseLifecycle } from "@/lib/factories/studentStatusFactory";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import ConsultModal, { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { makeId } from "@/lib/utils/id";
import { nowIso, todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";

export type TodaySessionRow = {
  studentId: string;
  token: string;
  studentName: string;
  index: number;
  effectiveISO: string;
  dateText: string;
  timeText: string;
  status: "planned" | "present" | "absent";
  badges?: string[];
  ddayLabel: string;
  ddayClass: string;
  percent: number;
  lastClass?: boolean;
  consultTag?: {
    label: string;
    badgeClassName: string;
    buttonClassName: string;
    purpose: "general" | "pause_request" | "extension";
    target: "student" | "parent";
    recordId: string;
  } | null;
};

type Props = {
  rows: TodaySessionRow[];
  role: "a" | "t" | "s";
};

function toDateYmd(iso?: string): string {
  const ymd = ymdFromISO_KST(iso);
  return ymd ?? todayYmdKST();
}

export default function TodaySessionsCard({ rows, role }: Props) {
  const isAdmin = role === "a";
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultStudentId, setConsultStudentId] = useState<string | null>(null);
  const [consultEditingId, setConsultEditingId] = useState<string | null>(null);
  const [consultForm, setConsultForm] = useState<ConsultFormState>({
    date: (() => {
      return todayYmdKST();
    })(),
    purpose: "general",
    target: "student",
    content: "",
    adminConsultDate: "",
    extensionResult: "",
    extensionPaymentDate: (() => {
      return todayYmdKST();
    })(),
    extensionAddedCount: 12,
    extensionPaymentConfirmed: false,
    finalNote: "",
    finalResult: "",
    pauseEffectiveDate: "",
    pauseRefundRatio: "",
    pauseRefundCompleted: false,
  });
  const [consultError, setConsultError] = useState("");

  function openConsult(row: TodaySessionRow) {
    setConsultStudentId(row.studentId);
    if (row.consultTag?.recordId) {
      const list = loadConsultationsByStudent(row.studentId);
      const record = list.find((r) => r.id === row.consultTag?.recordId);
      if (record) {
        setConsultEditingId(record.id);
        const purpose =
          record.purpose === "pause_request" || record.purpose === "extension" ? record.purpose : "general";
        setConsultForm({
          date: record.date || consultForm.date,
          purpose,
          target: record.target ?? "student",
          content: record.content ?? "",
          adminConsultDate: record.adminConsultDate ?? "",
          extensionResult: record.extensionResult ?? "",
          extensionPaymentDate: record.extensionPaymentDate ?? consultForm.date,
          extensionAddedCount: Math.max(1, Math.floor(Number(record.extensionAddedCount) || 12)),
          extensionPaymentConfirmed: Boolean(record.extensionPaymentConfirmed),
          finalNote: record.finalNote ?? "",
          finalResult: record.finalResult ?? "",
          pauseEffectiveDate: record.pauseEffectiveDate ?? "",
          pauseRefundRatio: record.pauseRefundRatio ?? "",
          pauseRefundCompleted: Boolean(record.pauseRefundCompleted),
        });
        setConsultError("");
        setConsultOpen(true);
        return;
      }
    }
    setConsultEditingId(null);
    setConsultForm({
      date: toDateYmd(row.effectiveISO),
      purpose: row.consultTag?.purpose ?? "general",
      target: row.consultTag?.target ?? "student",
      content: "",
      adminConsultDate: "",
      extensionResult: "",
      extensionPaymentDate: toDateYmd(row.effectiveISO),
      extensionAddedCount: 12,
      extensionPaymentConfirmed: false,
      finalNote: "",
      finalResult: "",
      pauseEffectiveDate: "",
      pauseRefundRatio: "",
      pauseRefundCompleted: false,
    });
    setConsultError("");
    setConsultOpen(true);
  }

  function saveConsult() {
    if (!consultStudentId) return;
    const list = loadConsultationsByStudent(consultStudentId);
    const err = validateConsultForm(consultForm, isAdmin);
    if (err) return setConsultError(err);
    const { updated } = buildConsultationRecord({
      records: list,
      editingId: consultEditingId,
      form: consultForm,
      nowIso: nowIso(),
      makeId,
    });
    saveConsultationsByStudent(consultStudentId, updated);
    setConsultOpen(false);

    if (isAdmin && consultForm.purpose === "pause_request") {
      const student = loadStudents().find((s) => s.id === consultStudentId);
      if (student) {
        if (consultForm.finalResult === "pause_confirm" && consultForm.pauseEffectiveDate) {
          const today = todayYmdKST();
          const pauseStatus = computePauseLifecycle(today, consultForm.pauseEffectiveDate) === "paused" ? "paused" : "confirmed";
          upsertStudent({
            ...student,
            status: "paused",
            pauseEffectiveDate: consultForm.pauseEffectiveDate,
            pauseStatus,
          });
        } else if (consultForm.finalResult === "pause_cancel") {
          upsertStudent({
            ...student,
            status: "active",
            pauseEffectiveDate: undefined,
            pauseStatus: "none",
          });
        }
      }
    }
  }

  function deleteConsult() {
    if (!consultStudentId || !consultEditingId) return;
    const list = loadConsultationsByStudent(consultStudentId);
    const updated = list.filter((r) => r.id !== consultEditingId);
    saveConsultationsByStudent(consultStudentId, updated);
    setConsultOpen(false);
  }

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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Badge className="bg-emerald-600 text-white">D-day</Badge>
        <div className="card-title">오늘의 수업</div>
        <Badge className="bg-slate-200 text-slate-700">{rows.length}개</Badge>
      </div>
      {rows.length === 0 ? (
        <div className="text-muted">오늘 수업이 없습니다.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => {
            const statusLabel =
              r.status === "present" ? "출석" : r.status === "absent" ? "결석" : "예정";
            const statusStyle = getStatusStyle(r.status);
            const percentColor =
              r.percent >= 80
                ? "#16a34a"
                : r.percent >= 75
                  ? "#2563eb"
                  : r.percent >= 50
                    ? "#ea580c"
                    : "#dc2626";

            return (
              <div
                key={`today-${r.token}-${r.index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "110px 1fr auto",
                  gap: 30,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  background: "#fff",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
              >
                <Link
                  href={`/${role}/smain/session/${r.index}`}
                  className="block"
                  style={{ display: "contents" }}
                  onClick={() => saveCurrentStudentToken(r.token)}
                >
                  <div style={{ fontWeight: 700 }}>{r.studentName}</div>
                  <div className="flex items-center gap-2 flex-wrap text-dim">
                    <div>
                      {r.dateText} {r.timeText}
                    </div>
                    {!(
                      r.lastClass &&
                      r.consultTag &&
                      r.consultTag.label === "휴회 예정"
                    ) ? (
                      <ConsultBadge tag={r.consultTag} />
                    ) : null}
                    {r.lastClass ? (
                      <Badge style={{ background: "#ef4444", color: "#fff" }}>마지막 수업</Badge>
                    ) : null}
                    {(r.badges ?? []).map((badge) => (
                      <Badge key={`${r.token}:${r.index}:${badge}`} style={{ background: "#f1f5f9", color: "#334155" }}>
                        {badge}
                      </Badge>
                    ))}
                    <Badge style={{ background: percentColor, color: "#fff" }}>{r.percent}%</Badge>
                    <Badge style={{ background: statusStyle.bg, color: statusStyle.text }}>{statusLabel}</Badge>
                  </div>
                </Link>
                <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                  <SessionQuickActions role={role} token={r.token} index={r.index} />
                  <ConsultButton tag={r.consultTag} onClick={() => openConsult(r)} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConsultModal
        open={consultOpen}
        role={role}
        state={consultForm}
        error={consultError}
        onChange={setConsultForm}
        onClose={() => setConsultOpen(false)}
        onSave={saveConsult}
        onDelete={consultEditingId ? deleteConsult : undefined}
      />
    </section>
  );
}
