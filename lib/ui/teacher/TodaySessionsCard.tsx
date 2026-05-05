// lib/ui/teacher/TodaySessionsCard.tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Badge from "@/lib/ui/common/Badge";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import { saveConsultationsByStudent } from "@/lib/storage/consultations";
import { upsertStudent } from "@/lib/storage/students";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import AchievementBadge from "@/lib/ui/common/AchievementBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";
import { getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import ConsultModal, { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";
import { submitConsultation } from "@/lib/ui/student/hooks/useConsultationSubmit";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { readSnapshotServerFirst } from "@/lib/storage/serverRead";
import { ConsultationRecord, PaymentRecord, Session, Student } from "@/lib/types/index";
import { canUseConsultFeatures } from "@/lib/policies/sessionRolePolicy";

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
  percent: number | null;
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
  title?: string;
  emptyText?: string;
  leadBadgeLabel?: string;
  leadBadgeClassName?: string;
};

function toDateYmd(iso?: string): string {
  const ymd = ymdFromISO_KST(iso);
  return ymd ?? todayYmdKST();
}

export default function TodaySessionsCard({
  rows,
  role,
  title = "오늘의 수업 ",
  emptyText = "오늘 수업이 없습니다.",
  leadBadgeLabel = "D-day",
  leadBadgeClassName = "bg-emerald-600 text-white",
}: Props) {
  const isAdmin = role === "a";
  const canUseConsult = canUseConsultFeatures(role);
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
  const [isSaving, setIsSaving] = useState(false);
  const [studentsById, setStudentsById] = useState<Record<string, Student>>({});
  const [consultationsByStudent, setConsultationsByStudent] = useState<Record<string, ConsultationRecord[]>>({});

  useEffect(() => {
    let cancelled = false;

    const refreshSnapshot = async () => {
      const next = await readSnapshotServerFirst();
      if (cancelled) return;

      const nextStudentsById: Record<string, Student> = {};
      for (const student of next.students) {
        nextStudentsById[student.id] = student;
      }
      setStudentsById(nextStudentsById);
      setConsultationsByStudent(next.consultations);
    };

    const requestRefresh = () => {
      void refreshSnapshot();
    };

    void refreshSnapshot();
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
    window.addEventListener(TUTORWEB_EVENTS.consultationsUpdated, requestRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
      window.removeEventListener(TUTORWEB_EVENTS.consultationsUpdated, requestRefresh);
    };
  }, []);

  const consultListOf = (studentId: string): ConsultationRecord[] => {
    return consultationsByStudent[studentId] ?? [];
  };

  function openConsult(row: TodaySessionRow) {
    if (!canUseConsult) return;
    setConsultStudentId(row.studentId);
    if (row.consultTag?.recordId) {
      const list = consultListOf(row.studentId);
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

  async function saveConsult(finalForm: ConsultFormState) {
    if (!canUseConsult) return;
    if (!consultStudentId) return;
    const student = studentsById[consultStudentId] ?? null;
    if (!student) return;

    const list = consultListOf(consultStudentId);
    const history = student.paymentHistory ?? [];
    const sessions: Session[] = []; // TodaySessionsCard에서는 세션 목록을 비워둬도 기본 저장 가능

    setIsSaving(true);
    try {
      const res = await submitConsultation(
        {
          isAdmin,
          actorRole: role,
          student,
          history,
          consultRecords: list,
          sessions,
          token: student.token || "",
          applyHistory: async (recs: PaymentRecord[], patch?: Partial<Student>, skip?: boolean, opts?: { consultationRecords?: ConsultationRecord[] }) => {
            const nextConsultRecords = opts?.consultationRecords ?? list;
            const updatedStudent = { ...student, ...patch, paymentHistory: recs };
            // Simple session count update
            const baseCount = student.planCount ?? 0;
            const added = recs.reduce((sum: number, r: PaymentRecord) => sum + r.addedCount, 0);
            updatedStudent.planCount = baseCount + added;

            upsertStudent(updatedStudent);
            saveConsultationsByStudent(student.id, nextConsultRecords);
            setStudentsById((prev) => ({ ...prev, [student.id]: updatedStudent }));
            setConsultationsByStudent((prev) => ({ ...prev, [student.id]: nextConsultRecords }));
            return true;
          },
          persistConsultationState: async (recs: ConsultationRecord[], patch?: Student) => {
            if (patch) {
              upsertStudent(patch);
              setStudentsById((prev) => ({ ...prev, [student.id]: patch }));
            }
            saveConsultationsByStudent(student.id, recs);
            setConsultationsByStudent((prev) => ({ ...prev, [student.id]: recs }));
            return true;
          },
        },
        finalForm,
        consultEditingId
      );

      if (res.error) {
        setConsultError(res.error);
        return;
      }
      if (res.ok) {
        setConsultOpen(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function deleteConsult() {
    if (!consultStudentId || !consultEditingId) return;
    const list = consultListOf(consultStudentId);
    const updated = list.filter((r) => r.id !== consultEditingId);
    saveConsultationsByStudent(consultStudentId, updated);
    setConsultationsByStudent((prev) => ({ ...prev, [consultStudentId]: updated }));
    setConsultOpen(false);
  }

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
            const statusBadge = getSessionStatusBadge(r.status);
            const detailHref = `/${role}/smain/session/${r.index}?token=${encodeURIComponent(r.token)}`;

            return (
              <div
                key={`today-${r.token}-${r.index}`}
                style={{
                  display: "flex",
                  gap: 20,
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  border: "1px solid var(--surface-border)",
                  borderRadius: 12,
                  background: "var(--surface-bg)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
              >
                <Link
                  href={detailHref}
                  style={{
                    flex: 1,
                    display: "grid",
                    gridTemplateColumns: "140px 1fr",
                    gap: 20,
                    alignItems: "center",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                  onClick={() => saveCurrentStudentToken(r.token)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: "1rem" }}>{r.studentName}</span>
                    <span style={{ fontSize: "1rem", opacity: 0.7, fontWeight: 600 }}>{r.index}회차</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-dim" style={{ fontSize: "0.95rem" }}>
                    {/* 1. 날짜 및 시간 */}
                    <div style={{ marginRight: 4 }}>
                      {r.dateText} {r.timeText}
                    </div>

                    {/* 2. 성취도(퍼센트) */}
                    <AchievementBadge percent={r.percent} />

                    {/* 3. 출결 상태 */}
                    <Badge style={statusBadge.style}>{statusBadge.label}</Badge>

                    {/* 4. 추가 배지 (변경/이월 등) */}
                    {(r.badges ?? []).filter(b => b !== "마지막 수업").map((badge) => (
                      <Badge key={`${r.token}:${r.index}:${badge}`} style={getSessionExtraBadgeStyle(badge)}>
                        {badge}
                      </Badge>
                    ))}

                    {/* 5. 상담 내역 배지 */}
                    {canUseConsult && !(r.lastClass && r.consultTag && r.consultTag.label === "휴회 예정") ? (
                      <ConsultBadge tag={r.consultTag} />
                    ) : null}

                    {/* 6. 마지막 수업 여부 */}
                    {r.lastClass || (r.badges ?? []).includes("마지막 수업") ? (
                      <Badge style={{ background: "#ef4444", color: "#fff" }}>마지막 수업</Badge>
                    ) : null}
                  </div>
                </Link>
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }} 
                  style={{ display: "flex", gap: 6, position: "relative", zIndex: 10 }}
                >
                  <SessionQuickActions role={role} token={r.token} index={r.index} />
                  {canUseConsult ? <ConsultButton tag={r.consultTag} onClick={() => openConsult(r)} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canUseConsult ? (
        <ConsultModal
          open={consultOpen}
          role={role}
          state={consultForm}
          error={consultError}
          onClose={() => setConsultOpen(false)}
          onSave={saveConsult}
          onDelete={consultEditingId ? deleteConsult : undefined}
          loading={isSaving}
        />
      ) : null}
    </section>
  );
}
