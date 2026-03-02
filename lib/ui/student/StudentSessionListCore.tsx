"use client";

import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { sessionsByStudent } from "@/lib/storage/sessions";
import { findStudentByToken, upsertStudent } from "@/lib/storage/students";
import { loadConsultationsByStudent, saveConsultationsByStudent } from "@/lib/storage/consultations";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  buildBadges,
  getSessionVisibility,
} from "@/lib/factories/sessionFactories";
import { useMetaMap, getDdayMeta } from "@/lib/factories/sessionFactories";
import { buildDisplayRecords, computeRefundRatio, type RefundRatio } from "@/lib/factories/lessonStatusFactory";
import { buildConsultationRecord, normalizeConsultPurpose, validateConsultForm } from "@/lib/factories/consultationFactory";
import { computePauseLifecycle } from "@/lib/factories/studentStatusFactory";
import Badge from "@/lib/ui/common/Badge";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import { buildConsultationMap, pickPrimaryConsultTag } from "@/lib/ui/session/consultationMap";
import { findLastClassIndex } from "@/lib/ui/session/pauseHelpers";
import { getAchievementBadgeStyle } from "@/lib/ui/common/achievementBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";
import { buildSessionContextBadges, getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import type { ConsultTag } from "@/lib/ui/session/consultationMap";
import { ConsultationRecord, PaymentRecord, Session, Student } from "@/lib/types/index";
import { useConsultationSubmit } from "./hooks/useConsultationSubmit";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import ConsultModal, { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import {
  calculateSessionProgressSummary,
  isSessionProgressEventKeyForToken,
} from "@/lib/factories/sessionProgressFactory";
import { canUseConsultFeatures } from "@/lib/policies/sessionRolePolicy";
import { todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";

type Props = {
  role: "a" | "t" | "s";
  token: string;
  prefix: string;
  hideTokenInRoute?: boolean;
};

function parseDateTime(iso: string | null | undefined) {
  if (!iso) return { dateText: "날짜 없음", timeText: "-" };
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return { dateText: "날짜 없음", timeText: "-" };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return { dateText: `${y}. ${m}. ${d}.`, timeText: `${hh}시 ${mm}분` };
}

function applyPauseStateFromConsultations(student: NonNullable<ReturnType<typeof findStudentByToken>>, records: ConsultationRecord[]) {
  const latestPause = [...records]
    .filter((r) => r.purpose === "pause_request" && (r.finalResult === "pause_confirm" || r.finalResult === "pause_cancel"))
    .sort((a, b) => {
      const ad = `${a.date ?? ""}|${a.createdAt ?? ""}`;
      const bd = `${b.date ?? ""}|${b.createdAt ?? ""}`;
      return ad.localeCompare(bd);
    })
    .at(-1);

  if (latestPause?.finalResult === "pause_confirm" && latestPause.pauseEffectiveDate) {
    const today = todayYmdKST();
    const pauseStatus = computePauseLifecycle(today, latestPause.pauseEffectiveDate) === "paused" ? "paused" : "confirmed";
    upsertStudent({
      ...student,
      status: "paused",
      pauseEffectiveDate: latestPause.pauseEffectiveDate,
      pauseStatus,
    });
    return;
  }

  upsertStudent({
    ...student,
    status: "active",
    pauseEffectiveDate: undefined,
    pauseStatus: "none",
  });
}

export default function StudentSessionListCore({ role, token, prefix, hideTokenInRoute = false }: Props) {
  void role;
  const isAdmin = role === "a";
  const [mounted, setMounted] = useState(false);
  const [progressTick, setProgressTick] = useState(0);

  // ✅ metaMap 배선 단일화
  const metaMap = useMetaMap(token);

  const [studentTick, setStudentTick] = useState(0);
  const student = useMemo(() => {
    void studentTick;
    return findStudentByToken(token) ?? null;
  }, [token, studentTick]);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultEditingId, setConsultEditingId] = useState<string | null>(null);
  const [consultForm, setConsultForm] = useState<ConsultFormState>({
    date: "",
    purpose: "general",
    target: "student",
    content: "",
    adminConsultDate: "",
    extensionResult: "",
    extensionPaymentDate: todayYmdKST(),
    extensionAddedCount: 12,
    extensionPaymentConfirmed: false,
    finalNote: "",
    finalResult: "",
    pauseEffectiveDate: "",
    pauseRefundRatio: "",
    pauseRefundCompleted: false,
  });
  const [consultError, setConsultError] = useState("");
  const [consultTick, setConsultTick] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onConsult = () => setConsultTick((x) => x + 1);
    const onStudents = () => setStudentTick((x) => x + 1);
    const onProgressChanged: EventListener = (event) => {
      const ce = event as CustomEvent<{ key?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (!key) return;
      if (!isSessionProgressEventKeyForToken(key, token)) return;
      setProgressTick((x) => x + 1);
    };
    window.addEventListener(TUTORWEB_EVENTS.consultationsUpdated, onConsult);
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, onStudents);
    window.addEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);
    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.consultationsUpdated, onConsult);
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, onStudents);
      window.removeEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);
    };
  }, [token]);



  // baseDates는 규칙 기반이라 자주 변하지 않음(토큰 기준)
  const baseDatesISO = useMemo(() => buildBaseDatesISOByToken(token, 60), [token]);

  const sessions = useMemo(() => (student ? sessionsByStudent(student.id) : []), [student]);
  const consultRecords = useMemo(
    () => {
      void consultTick;
      return student ? loadConsultationsByStudent(student.id) : [];
    },
    [student, consultTick]
  );

  const progressByIndex = useMemo(() => {
    if (!mounted) return {} as Record<number, { done: number; total: number; percent: number }>;
    void progressTick;
    const out: Record<number, { done: number; total: number; percent: number }> = {};
    for (const s of sessions) {
      out[s.index] = calculateSessionProgressSummary({
        token,
        sessionIndex: s.index,
      });
    }
    return out;
  }, [mounted, token, sessions, progressTick]);

  const refundCompletedIndex = useMemo(() => {
    if (!student) return null;
    const history = student.paymentHistory ?? [];
    const displayRecords = buildDisplayRecords(student, history).displayRecords;
    const indices = displayRecords
      .filter((r) => r.refundStatus === "completed" && Number.isFinite(r.refundSessionIndex))
      .map((r) => Number(r.refundSessionIndex));
    if (indices.length === 0) return null;
    return Math.min(...indices);
  }, [student]);
  const refundRequestedIndex = useMemo(() => {
    if (!student) return null;
    const history = student.paymentHistory ?? [];
    const displayRecords = buildDisplayRecords(student, history).displayRecords;
    const indices = displayRecords
      .filter((r) => r.refundStatus === "requested" && Number.isFinite(r.refundSessionIndex))
      .map((r) => Number(r.refundSessionIndex));
    if (indices.length === 0) return null;
    return Math.min(...indices);
  }, [student]);

  const displayRecords = useMemo(() => {
    if (!student) return [];
    const history = student.paymentHistory ?? [];
    return buildDisplayRecords(student, history).displayRecords;
  }, [student]);

  const rows = useMemo(() => {
    if (!student) return [];
    const lastClassIndex =
      (student.pauseStatus === "confirmed" || student.pauseStatus === "paused") && student.pauseEffectiveDate
        ? findLastClassIndex({
          token,
          sessions,
          baseDatesISO,
          metaMap,
          pauseEffectiveDate: student.pauseEffectiveDate,
        })
        : null;

    return sessions
      .map((s) => {
        const visibility = getSessionVisibility({
          index: s.index,
          lastVisibleIndex: lastClassIndex,
        });
        if (visibility === "hidden") return null;
        const { effectiveISO, meta } = computeEffectiveISO({
          token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });

        const { dateText, timeText } = parseDateTime(effectiveISO);
        const badges = buildSessionContextBadges({
          baseBadges: buildBadges(meta),
          lastClass: Boolean(lastClassIndex && s.index === lastClassIndex),
          refundStatus:
            refundCompletedIndex && s.index === refundCompletedIndex
              ? "completed"
              : refundRequestedIndex && s.index === refundRequestedIndex
                ? "requested"
                : null,
        });

        // ✅ D-day 레고: mounted 이전에는 diff를 만들지 않음(SSR mismatch 방지)
        const dday = mounted ? getDdayMeta(effectiveISO, new Date()) : null;
        const progress = progressByIndex[s.index] ?? { done: 0, total: 0, percent: 0 };

        return {
          index: s.index,
          effectiveISO: effectiveISO ?? "",
          dateText,
          timeText,
          status: meta.status ?? "planned",
          badges,
          dday, // { diff, label, className } | null
          progress,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [student, token, baseDatesISO, metaMap, mounted, sessions, progressByIndex, refundCompletedIndex, refundRequestedIndex]);

  const consultMap = useMemo(() => {
    if (!student) return {};
    return buildConsultationMap({
      token,
      sessions,
      records: consultRecords,
      baseDatesISO,
      metaMap,
    });
  }, [student, token, sessions, consultRecords, baseDatesISO, metaMap]);

  const computedPauseRefundRatio = useMemo<"" | RefundRatio>(() => {
    if (!student) return "";
    if (consultForm.purpose !== "pause_request" || consultForm.finalResult !== "pause_confirm") return "";
    if (!consultForm.pauseEffectiveDate) return "";

    const entries = sessions
      .map((s) => {
        const { effectiveISO } = computeEffectiveISO({
          token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });
        const ymd = ymdFromISO_KST(effectiveISO) ?? "";
        return { index: s.index, ymd };
      })
      .filter((e) => !!e.ymd);
    if (entries.length === 0) return "";

    const target = consultForm.pauseEffectiveDate;
    const same = entries.filter((e) => e.ymd === target).sort((a, b) => a.index - b.index);
    const future = entries.filter((e) => e.ymd > target).sort((a, b) => a.ymd.localeCompare(b.ymd));
    const past = entries.filter((e) => e.ymd < target).sort((a, b) => b.ymd.localeCompare(a.ymd));
    const lastIdx = same[0]?.index ?? future[0]?.index ?? past[0]?.index ?? null;
    if (!lastIdx) return "";

    const requestIndex = lastIdx + 1;
    const refundTarget = displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex);
    return refundTarget ? computeRefundRatio(refundTarget, requestIndex, Boolean(refundTarget.isBase)) : "";
  }, [student, consultForm.purpose, consultForm.finalResult, consultForm.pauseEffectiveDate, sessions, token, baseDatesISO, metaMap, displayRecords]);

  const ymdFromISO = (iso: string) => {
    if (!iso) return todayYmdKST();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  };

  const openConsultForSession = (iso: string, tag: ConsultTag | null) => {
    if (tag?.recordId) {
      const record = consultRecords.find((r) => r.id === tag.recordId);
      if (record) {
        setConsultEditingId(record.id);
        setConsultForm({
          date: record.date || ymdFromISO(iso),
          purpose: normalizeConsultPurpose((record as { purpose?: unknown }).purpose),
          target: record.target ?? "student",
          content: record.content ?? "",
          adminConsultDate: record.adminConsultDate ?? "",
          extensionResult: record.extensionResult ?? "",
          extensionPaymentDate: record.extensionPaymentDate ?? todayYmdKST(),
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
      date: ymdFromISO(iso),
      purpose: tag?.purpose ?? "general",
      target: tag?.target ?? "student",
      content: "",
      adminConsultDate: "",
      extensionResult: "",
      extensionPaymentDate: todayYmdKST(),
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
  };

  const { submit: submitConsult } = useConsultationSubmit({
    isAdmin,
    student,
    history: student?.paymentHistory ?? [],
    consultRecords: consultRecords ?? [],
    sessions,
    token,
    applyHistory: async (recs: PaymentRecord[], patch?: Partial<Student>, skip?: boolean, opts?: { consultationRecords?: ConsultationRecord[] }) => {
      if (!student) return false;
      const nextConsultRecords = opts?.consultationRecords ?? consultRecords;
      const updatedStudent = { ...student, ...patch, paymentHistory: recs };
      // Simple session count update
      const baseCount = student.planCount ?? 0;
      const added = recs.reduce((sum: number, r: PaymentRecord) => sum + r.addedCount, 0);
      updatedStudent.planCount = baseCount + added;

      upsertStudent(updatedStudent);
      saveConsultationsByStudent(student.id, nextConsultRecords);
      return true;
    },
    persistConsultationState: async (recs: ConsultationRecord[], patch?: Student) => {
      if (!student) return false;
      if (patch) upsertStudent(patch);
      saveConsultationsByStudent(student.id, recs);
      return true;
    },
  });

  const saveConsultRecord = async () => {
    if (!student) return;
    const formForSave =
      consultForm.purpose === "pause_request" && consultForm.finalResult === "pause_confirm"
        ? { ...consultForm, pauseRefundRatio: computedPauseRefundRatio }
        : consultForm;

    const res = await submitConsult(formForSave, consultEditingId);
    if (res.error) {
      setConsultError(res.error);
      return;
    }
    if (res.ok) {
      setConsultOpen(false);
      setConsultTick((x) => x + 1);
    }
  };

  const deleteConsultRecord = () => {
    if (!student || !consultEditingId) return;
    const deleting = consultRecords.find((r) => r.id === consultEditingId);
    const updated = consultRecords.filter((r) => r.id !== consultEditingId);
    saveConsultationsByStudent(student.id, updated);
    setConsultTick((x) => x + 1);
    if (isAdmin && deleting?.purpose === "pause_request") {
      applyPauseStateFromConsultations(student, updated);
    }
    setConsultOpen(false);
  };


  const { upcomingRows, pastRows } = useMemo(() => {
    const upcoming: typeof rows = [];
    const past: typeof rows = [];

    for (const r of rows) {
      if (refundCompletedIndex && r.index > refundCompletedIndex && r.dday && r.dday.diff !== null && r.dday.diff >= 0) {
        continue;
      }
      const diff = r.dday?.diff;
      if (diff === null || diff === undefined) {
        upcoming.push(r);
        continue;
      }
      if (diff >= 0) upcoming.push(r);
      else past.push(r);
    }

    return { upcomingRows: upcoming, pastRows: past };
  }, [rows, refundCompletedIndex]);

  const pastDesc = useMemo(() => [...pastRows].sort((a, b) => b.index - a.index), [pastRows]);
  const visibleUpcoming = showAllUpcoming ? upcomingRows : upcomingRows.slice(0, 3);
  const visiblePast = showAllPast ? pastDesc : pastDesc.slice(0, 5);

  if (!mounted) return null;

  return (
    <div className="space-y-3 p-4">
      <div style={{ textAlign: "center" }}>
        <div className="text-base font-normal">
          <span className="page-title">{student ? student.name : "학생"} 수업 목록</span>
        </div>
      </div>

      <div className="space-y-5">
        <div
          className="space-y-2 rounded-xl border p-3"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
        >
          <div className="card-title">예정 수업</div>
          {upcomingRows.length === 0 ? (
            <div className="text-muted">예정된 수업이 없습니다.</div>
          ) : null}
          {visibleUpcoming.map((r) => {
            const href = hideTokenInRoute ? `${prefix}/session/${r.index}` : `${prefix}/${token}/session/${r.index}`;
            const consultTag = pickPrimaryConsultTag(consultMap[r.index]);

            const cls = !r.dday || r.dday.diff === null ? "bg-slate-400" : r.dday.className;
            const label = !r.dday ? "-" : r.dday.label;

            const statusBadge = getSessionStatusBadge(r.status);
            return (
              <div
                key={`upcoming-${r.index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid var(--surface-border)",
                  borderRadius: 8,
                  background: "var(--surface-bg)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
              >
                <Link
                  href={href}
                  className="block"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr",
                    gap: 30,
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
                    <Badge className={`text-white ${cls}`}>{label}</Badge>
                    <span>{r.index}회차</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-dim">
                    <div>
                      {r.dateText} {r.timeText}
                    </div>
                    <Badge style={getAchievementBadgeStyle(r.progress.percent)}>{r.progress.percent}%</Badge>
                    <Badge style={statusBadge.style}>{statusBadge.label}</Badge>
                    {!(
                      consultTag &&
                      consultTag.label === "휴회 예정" &&
                      r.badges.includes("마지막 수업")
                    ) ? (
                      <ConsultBadge tag={consultTag} />
                    ) : null}
                    {r.badges.length > 0 ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.badges.map((b) => (
                          <Badge key={`${r.index}:${b}`} style={getSessionExtraBadgeStyle(b)}>
                            {b}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
                {canUseConsultFeatures(role) ? (
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                    <SessionQuickActions role={role} token={token} index={r.index} />
                    <ConsultButton tag={consultTag} onClick={() => openConsultForSession(r.effectiveISO, consultTag)} />
                  </div>
                ) : null}
              </div>
            );
          })}
          {upcomingRows.length > 3 ? (
            <button
              onClick={() => setShowAllUpcoming((prev) => !prev)}
              className="block w-full rounded-xl border p-3 text-sm font-semibold"
              style={{
                borderColor: "var(--surface-border)",
                background: "var(--surface-bg)",
                color: "var(--text-subtle)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
            >
              {showAllUpcoming ? "접기" : "펼치기"}
            </button>
          ) : null}
        </div>

        <div
          className="space-y-2 rounded-xl border p-3"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
        >
          <div className="card-title">지난 수업</div>
          {pastRows.length === 0 ? (
            <div className="text-muted">지난 수업이 없습니다.</div>
          ) : null}
          {visiblePast.map((r) => {
            const href = hideTokenInRoute ? `${prefix}/session/${r.index}` : `${prefix}/${token}/session/${r.index}`;
            const consultTag = pickPrimaryConsultTag(consultMap[r.index]);

            const cls = !r.dday || r.dday.diff === null ? "bg-slate-400" : r.dday.className;
            const label = !r.dday ? "-" : r.dday.label;

            const statusBadge = getSessionStatusBadge(r.status);
            return (
              <div
                key={`past-${r.index}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid var(--surface-border)",
                  borderRadius: 8,
                  background: "var(--surface-bg)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
              >
                <Link
                  href={href}
                  className="block"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 1fr",
                    gap: 30,
                    alignItems: "center",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
                    <Badge className={`text-white ${cls}`}>{label}</Badge>
                    <span>{r.index}회차</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-dim">
                    <div>
                      {r.dateText} {r.timeText}
                    </div>
                    <Badge style={getAchievementBadgeStyle(r.progress.percent)}>{r.progress.percent}%</Badge>
                    <Badge style={statusBadge.style}>{statusBadge.label}</Badge>
                    {!(
                      consultTag &&
                      consultTag.label === "휴회 예정" &&
                      r.badges.includes("마지막 수업")
                    ) ? (
                      <ConsultBadge tag={consultTag} />
                    ) : null}
                    {r.badges.length > 0 ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        {r.badges.map((b) => (
                          <Badge key={`past-${r.index}:${b}`} style={getSessionExtraBadgeStyle(b)}>
                            {b}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </Link>
                {canUseConsultFeatures(role) ? (
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                    <SessionQuickActions role={role} token={token} index={r.index} />
                    <ConsultButton tag={consultTag} onClick={() => openConsultForSession(r.effectiveISO, consultTag)} />
                  </div>
                ) : null}
              </div>
            );
          })}
          {pastDesc.length > 5 ? (
            <button
              onClick={() => setShowAllPast((prev) => !prev)}
              className="block w-full rounded-xl border p-3 text-sm font-semibold"
              style={{
                borderColor: "var(--surface-border)",
                background: "var(--surface-bg)",
                color: "var(--text-subtle)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
            >
              {showAllPast ? "접기" : "펼치기"}
            </button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <div className="text-muted">회차가 없습니다.</div>
        ) : null}
      </div>

      <ConsultModal
        open={consultOpen}
        role={role}
        state={{
          ...consultForm,
          pauseRefundRatio:
            consultForm.purpose === "pause_request" && consultForm.finalResult === "pause_confirm"
              ? computedPauseRefundRatio
              : consultForm.pauseRefundRatio,
        }}
        error={consultError}
        onChange={setConsultForm}
        onClose={() => setConsultOpen(false)}
        onSave={saveConsultRecord}
        onDelete={consultEditingId ? deleteConsultRecord : undefined}
      />
    </div>
  );
}
