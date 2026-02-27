"use client";

import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { findStudentByToken, upsertStudent } from "@/lib/storage/students";
import { loadTeachers, TEACHERS_EVENT } from "@/lib/storage/teachers";
import { loadConsultationsByStudent, saveConsultationsByStudent } from "@/lib/storage/consultations";
import { buildConsultationMap, pickPrimaryConsultTag, type ConsultTag } from "@/lib/ui/session/consultationMap";
import { findClassIndexByDatePreferFuture, findLastClassIndex } from "@/lib/ui/session/pauseHelpers";
import { formatGrade, formatPhone, formatSchedule } from "@/lib/ui/student/formatters";
import { loadSessions, saveSessions, sessionsByStudent, upsertSession } from "@/lib/storage/sessions";
import {
  buildBadges,
  buildBaseDatesISO,
  computeEffectiveISO,
  getDdayMeta,
  getSessionVisibility,
  getStatusStyle,
  readMetaMap,
  upsertMeta,
  useMetaMap,
} from "@/lib/factories/sessionFactories";
import {
  buildDisplayRecords,
  computeBaseCount,
  normalizePaymentHistoryRanges,
  computeRefundRatio,
  refundRatioLabel,
} from "@/lib/factories/lessonStatusFactory";
import { buildConsultationRecord, normalizeConsultPurpose, validateConsultForm } from "@/lib/factories/consultationFactory";
import {
  computePauseLifecycle,
  computeStudentStatusFromMetrics,
  getStudentStatusMeta,
} from "@/lib/factories/studentStatusFactory";
import type {
  ConsultationRecord,
  PaymentRecord,
  ScheduleRule,
  Session,
  Student,
  Weekday,
} from "@/lib/types/index";
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import { syncSessionDisplayAtByToken } from "@/lib/ui/session/syncSessionDisplayAt";
import AutoResizeTextarea from "@/lib/ui/common/AutoResizeTextarea";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import { getAchievementBadgeStyle } from "@/lib/ui/common/achievementBadge";
import ConsultModal, { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { makeId } from "@/lib/utils/id";
import { kstDateMs, nowIso, todayYmdKST } from "@/lib/utils/date";

type Role = "s" | "t" | "a";

function weekdayLabel(n: number) {
  return ["일", "월", "화", "수", "목", "금", "토"][n] ?? String(n);
}

function normalizeHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function normalizeMinute(n: number): 0 | 30 {
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(30, Math.floor(n)));
  return clamped >= 15 ? 30 : 0;
}

function ymdFromISO_KST(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${dd}`;
}

function ymdAddDays(ymd: string, days: number): string {
  const base = new Date(`${ymd}T00:00:00+09:00`);
  base.setUTCDate(base.getUTCDate() + days);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(base);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

function weekdayFromYmdKST(ymd: string): number {
  const dt = new Date(`${ymd}T12:00:00+09:00`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", weekday: "short" }).format(dt);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

function isoFromKst(ymd: string, hour: number, minute: number): string {
  return `${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`;
}

function hmFromISO_KST(iso?: string): { hour: number; minute: number } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { hour, minute };
}

function rulesForIndex(student: Student, index: number): ScheduleRule[] {
  const changes = [...(student.scheduleChangeEvents ?? [])].sort((a, b) => a.startIndex - b.startIndex);
  let rules = [...(student.scheduleRules ?? [])];
  for (const ch of changes) {
    if (ch.startIndex <= index) rules = [...(ch.newRules ?? [])];
  }
  return rules;
}

function nextIsoFromRules(args: {
  rules: ScheduleRule[];
  fromYmd?: string;
  afterISO?: string;
}): string | null {
  const sorted = [...(args.rules ?? [])].sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
  if (sorted.length === 0) return null;
  const afterMs = args.afterISO ? new Date(args.afterISO).getTime() : null;
  let cur = args.fromYmd ?? (args.afterISO ? ymdFromISO_KST(args.afterISO) : null);
  if (!cur) return null;

  for (let guard = 0; guard < 1200; guard++) {
    const wd = weekdayFromYmdKST(cur);
    for (const r of sorted) {
      if (r.weekday !== wd) continue;
      const iso = isoFromKst(cur, r.hour, r.minute);
      const ms = new Date(iso).getTime();
      if (!Number.isFinite(ms)) continue;
      if (afterMs === null || ms > afterMs) return iso;
    }
    cur = ymdAddDays(cur, 1);
  }
  return null;
}

function applyPauseStateFromConsultations(student: Student, records: ConsultationRecord[]) {
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

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = browserStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function StudentHubCore({
  role,
  token,
  prefix,
  hideTokenInRoute = false,
  editPrefix,
}: {
  role: Role;
  token: string;
  prefix: string; // "/a/students" | "/t/students" | "/s"
  hideTokenInRoute?: boolean;
  editPrefix?: string;
}) {
  const router = useRouter();
  const accessRole: Role = role;
  const isAdmin = accessRole === "a";
  const [mounted, setMounted] = useState(false);
  const [showPaymentPanel, setShowPaymentPanel] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [teachers, setTeachers] = useState(() => loadTeachers());
  const [paymentDate, setPaymentDate] = useState(() => todayYmdKST());
  const [addedCount, setAddedCount] = useState<number>(12);
  const [paymentMemo, setPaymentMemo] = useState("");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundMode, setRefundMode] = useState<"request" | "process">("request");
  const [refundRecordId, setRefundRecordId] = useState<string | null>(null);
  const [refundSessionInput, setRefundSessionInput] = useState<number>(0);
  const [refundReasonInput, setRefundReasonInput] = useState("");
  const [refundConsultInput, setRefundConsultInput] = useState("");
  const [refundProcessedDate, setRefundProcessedDate] = useState(() => todayYmdKST());
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [consultOpen, setConsultOpen] = useState(false);
  const [consultEditingId, setConsultEditingId] = useState<string | null>(null);
  const [consultForm, setConsultForm] = useState<ConsultFormState>({
    date: todayYmdKST(),
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
  const [scheduleEditOpen, setScheduleEditOpen] = useState(false);
  const [scheduleStartIndex, setScheduleStartIndex] = useState(1);
  const [scheduleStartDate, setScheduleStartDate] = useState("");
  const [scheduleDays, setScheduleDays] = useState<Record<number, { on: boolean; hour: number; minute: 0 | 30 }>>(
    () => {
      const init: Record<number, { on: boolean; hour: number; minute: 0 | 30 }> = {};
      for (const d of [0, 1, 2, 3, 4, 5, 6]) init[d] = { on: false, hour: 17, minute: 0 };
      return init;
    }
  );
  const [scheduleError, setScheduleError] = useState("");
  const [actionMode, setActionMode] = useState<null | "edit" | "refundRequest" | "refundProcess">(null);
  const [progressTick, setProgressTick] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const bump = () => setRefreshTick((x) => x + 1);

    const onStudents = () => bump();
    const onSessions = () => bump();
    const onTeachers = () => setTeachers(loadTeachers());
    const onStorage: EventListener = (e) => {
      const se = e as StorageEvent;
      if (!se.key) return;
      if (se.key === "tutorweb_students_v1" || se.key === "tutorweb_sessions_v1") bump();
      if (se.key === "tutorweb_teachers_v1") setTeachers(loadTeachers());
    };
    const onProgressChanged: EventListener = (event) => {
      const ce = event as CustomEvent<{ key?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (!key) return;
      if (!key.startsWith(`mk3:${token}:session:`)) return;
      if (!key.endsWith(":leafIds") && !key.endsWith(":progressByLeafId")) return;
      setProgressTick((x) => x + 1);
    };

    window.addEventListener("tutorweb:studentsUpdated", onStudents);
    window.addEventListener("tutorweb:sessionsUpdated", onSessions);
    window.addEventListener(TEACHERS_EVENT, onTeachers);
    window.addEventListener("storage", onStorage);
    window.addEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);

    return () => {
      window.removeEventListener("tutorweb:studentsUpdated", onStudents);
      window.removeEventListener("tutorweb:sessionsUpdated", onSessions);
      window.removeEventListener(TEACHERS_EVENT, onTeachers);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);
    };
  }, [token]);

  const student = useMemo<Student | null>(() => {
    void refreshTick;
    return token ? (findStudentByToken(token) ?? null) : null;
  }, [token, refreshTick]);
  const sessions = useMemo(() => (student ? sessionsByStudent(student.id) : []), [student]);
  const metaMap = useMetaMap(token);
  const baseDatesISO = useMemo(() => (student ? buildBaseDatesISO(student, 60) : []), [student]);
  const currentCount = useMemo(() => {
    const plan = student?.planCount ?? 0;
    return Math.max(plan, sessions.length);
  }, [student, sessions]);

  const teacherName = useMemo(() => {
    const tid = student?.teacherId ?? null;
    if (!tid) return "-";
    return teachers.find((t) => t.id === tid)?.name ?? "-";
  }, [student, teachers]);

  const teacherEmail = useMemo(() => {
    const tid = student?.teacherId ?? null;
    if (!tid) return "-";
    return teachers.find((t) => t.id === tid)?.email ?? "-";
  }, [student, teachers]);

  const scheduleText = useMemo(() => {
    const rules = student?.scheduleRules ?? [];
    if (!rules.length) return "-";
    return formatSchedule(rules);
  }, [student]);
  const currentScheduleText = useMemo(() => {
    if (!student) return scheduleText;
    const changes = student?.scheduleChangeEvents ?? [];
    if (changes.length === 0) return scheduleText;
    const sorted = [...changes].sort((a, b) => a.startIndex - b.startIndex);
    const today = todayYmdKST();
    let activeRules = [...(student.scheduleRules ?? [])];
    for (const ch of sorted) {
      if (!Array.isArray(ch.newRules) || ch.newRules.length === 0) continue;
      if (ch.startDate && ch.startDate > today) continue;
      activeRules = [...ch.newRules];
    }
    return activeRules.length ? formatSchedule(activeRules) : scheduleText;
  }, [student, scheduleText]);

  const parentRoleLabel = useMemo(() => {
    const pr = student?.parentRole;
    if (pr === "father") return "부";
    if (pr === "mother") return "모";
    return "-";
  }, [student]);
  const [consultRecords, setConsultRecords] = useState<ConsultationRecord[]>([]);

  useEffect(() => {
    if (!student) {
      setConsultRecords([]);
      return;
    }
    setConsultRecords(loadConsultationsByStudent(student.id));
  }, [student]);

  useEffect(() => {
    const onConsult = () => {
      if (!student) return;
      setConsultRecords(loadConsultationsByStudent(student.id));
    };
    window.addEventListener("tutorweb:consultationsUpdated", onConsult);
    return () => window.removeEventListener("tutorweb:consultationsUpdated", onConsult);
  }, [student]);

  const studentStatusView = useMemo(() => {
    if (!student) return { label: "-", bg: "#6b7280", color: "#fff" };

    const today = todayYmdKST();
    const pauseDate = student.pauseEffectiveDate;
    const latestPause = [...consultRecords]
      .filter((r) => r.purpose === "pause_request")
      .sort((a, b) => {
        const ad = `${a.date ?? ""}|${a.createdAt ?? ""}`;
        const bd = `${b.date ?? ""}|${b.createdAt ?? ""}`;
        return ad.localeCompare(bd);
      })
      .at(-1);

    const pauseLifecycle = computePauseLifecycle(today, pauseDate);
    let passedCount = 0;
    for (const s of sessions) {
      const { effectiveISO } = computeEffectiveISO({
        token,
        index: s.index,
        baseDatesISO,
        metaMap,
      });
      if (!effectiveISO) continue;
      const ymd = ymdFromISO_KST(effectiveISO);
      if (ymd && ymd < today) passedCount += 1;
    }

    const remainingCount = Math.max(0, currentCount - passedCount);
    const lastSessionISO = sessions
      .map((s) =>
        computeEffectiveISO({
          token,
          index: s.index,
          baseDatesISO,
          metaMap,
        }).effectiveISO
      )
      .filter((iso): iso is string => Boolean(iso))
      .sort()
      .at(-1);
    const finishedAll = currentCount > 0 && passedCount >= currentCount;
    const lastYmd = lastSessionISO ? ymdFromISO_KST(lastSessionISO) ?? "" : "";
    const todayMs = kstDateMs(today);
    const lastMs = lastYmd ? kstDateMs(lastYmd) : null;
    const overdueDays =
      finishedAll && todayMs !== null && lastMs !== null
        ? Math.floor((todayMs - lastMs) / 86400000)
        : 0;

    const kind = computeStudentStatusFromMetrics({
      pauseLifecycle,
      hasPendingPauseRequest: Boolean(latestPause && !latestPause.finalResult),
      overdueDays,
      remainingCount,
      passedCount,
    });
    const meta = getStudentStatusMeta(kind);
    return { label: meta.label, bg: meta.bg, color: meta.color };
  }, [student, sessions, token, baseDatesISO, metaMap, currentCount, consultRecords]);

  const showParentPhone = accessRole !== "s"; // 학생은 숨김(정책 확정)
  const canEdit = accessRole !== "s"; // 학생 편집 없음(정책 확정)

  const sessionListHref = hideTokenInRoute ? `${prefix}/session` : `${prefix}/${encodeURIComponent(token)}/session`;
  const editHrefBase = editPrefix ?? prefix;
  const editHref = hideTokenInRoute ? `${editHrefBase}/edit` : `${editHrefBase}/${encodeURIComponent(token)}/edit`;
  const boxButton = {
    border: "1px solid var(--control-border)",
    borderRadius: 6,
    background: "var(--surface-bg)",
    color: "var(--foreground)",
    cursor: "pointer",
  };
  const inputStyle = {
    border: "1px solid var(--control-border)",
    background: "var(--surface-bg)",
    color: "var(--foreground)",
    borderRadius: 6,
    padding: "6px 8px",
  };
  const selectStyle = {
    border: "1px solid var(--control-border)",
    background: "var(--surface-bg)",
    color: "var(--foreground)",
    borderRadius: 8,
    padding: 8,
    width: "100%",
    minWidth: 60,
  };

  function resolveScheduleStartIndexByDate(targetDate: string): number {
    if (!student) return Math.max(1, currentCount + 1);
    const targetMs = new Date(`${targetDate}T00:00:00+09:00`).getTime();
    if (!Number.isFinite(targetMs)) return Math.max(1, currentCount + 1);

    const baseDates = buildBaseDatesISO(student, 120);
    const localMetaMap = readMetaMap(token);
    const scanMax = Math.max(currentCount, baseDates.length);

    let nearestFutureIdx: number | null = null;
    let nearestFutureMs = Number.POSITIVE_INFINITY;

    for (let i = 1; i <= scanMax; i++) {
      const { effectiveISO } = computeEffectiveISO({
        token,
        index: i,
        baseDatesISO: baseDates,
        metaMap: localMetaMap,
      });
      if (!effectiveISO) continue;

      const ymd = ymdFromISO_KST(effectiveISO);
      if (!ymd) continue;
      const ms = new Date(`${ymd}T00:00:00+09:00`).getTime();
      if (!Number.isFinite(ms)) continue;

      if (ms < targetMs) continue;
      if (ms < nearestFutureMs || (ms === nearestFutureMs && (nearestFutureIdx === null || i < nearestFutureIdx))) {
        nearestFutureMs = ms;
        nearestFutureIdx = i;
      }
    }

    if (nearestFutureIdx !== null) return nearestFutureIdx;
    return Math.max(1, scanMax + 1);
  }

  const backToTmain =
    accessRole === "a" ? "/a/tmain" : accessRole === "t" ? "/t/tmain" : null;

  const history = useMemo(() => student?.paymentHistory ?? [], [student]);
  const formatYmdDot = (ymd?: string) => (ymd ? ymd.replace(/-/g, ".") : "-");
  const baseCount = useMemo(() => computeBaseCount(student, history), [student, history]);
  const displayRecords = useMemo(
    () => buildDisplayRecords(student, history, baseCount).displayRecords,
    [student, history, baseCount]
  );

  const refundCompletedIndex = useMemo(() => {
    const indices = displayRecords
      .filter((r) => r.refundStatus === "completed" && Number.isFinite(r.refundSessionIndex))
      .map((r) => Number(r.refundSessionIndex));
    if (indices.length === 0) return null;
    return Math.min(...indices);
  }, [displayRecords]);
  const refundRequestedIndex = useMemo(() => {
    const indices = displayRecords
      .filter((r) => r.refundStatus === "requested" && Number.isFinite(r.refundSessionIndex))
      .map((r) => Number(r.refundSessionIndex));
    if (indices.length === 0) return null;
    return Math.min(...indices);
  }, [displayRecords]);
  const refundRecord = useMemo(
    () => (refundRecordId ? displayRecords.find((h) => h.id === refundRecordId) ?? null : null),
    [refundRecordId, displayRecords]
  );
  const editingRange = useMemo(() => {
    if (!editingRecordId) {
      const start = currentCount + 1;
      const end = start + Math.max(0, addedCount) - 1;
      return { start, end };
    }

    const idx = history.findIndex((h) => h.id === editingRecordId);
    if (idx < 0) {
      const start = currentCount + 1;
      const end = start + Math.max(0, addedCount) - 1;
      return { start, end };
    }

    const prevSum = history
      .slice(0, idx)
      .reduce((sum, h) => sum + Math.max(0, Math.floor(Number(h.addedCount) || 0)), 0);
    const start = baseCount + prevSum + 1;
    const end = start + Math.max(0, addedCount) - 1;
    return { start, end };
  }, [editingRecordId, currentCount, baseCount, history, addedCount]);

  const progressPercent = useMemo(() => {
    void progressTick;
    return (index: number) => {
      const baseKey = `mk3:${token}:session:${index}`;
      const leafIds = readJson<string[]>(`${baseKey}:leafIds`, []);
      const progress = readJson<Record<string, { noteDone?: boolean; solveDone?: boolean }>>(
        `${baseKey}:progressByLeafId`,
        {}
      );
      const ids = Array.isArray(leafIds) ? leafIds : [];
      const total = ids.length * 2;
      const done = ids.reduce((acc, id) => {
        const p = progress?.[id];
        return acc + (p?.noteDone ? 1 : 0) + (p?.solveDone ? 1 : 0);
      }, 0);
      return total === 0 ? 0 : Math.round((done / total) * 100);
    };
  }, [token, progressTick]);

  const upcomingSessions = useMemo(() => {
    if (!student) return [];
    const now = new Date();
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
    const candidates: {
      index: number;
      iso: string;
      status?: string;
      badges: string[];
      percent: number;
      refundCompleted?: boolean;
      refundRequested?: boolean;
      lastClass?: boolean;
    }[] = [];

    for (const s of sessions) {
      if (refundCompletedIndex && s.index > refundCompletedIndex) continue;
      const visibility = getSessionVisibility({
        index: s.index,
        lastVisibleIndex: lastClassIndex,
      });
      if (visibility === "hidden") continue;
      const { effectiveISO } = computeEffectiveISO({
        token,
        index: s.index,
        baseDatesISO,
        metaMap,
      });
      if (!effectiveISO) continue;
      const t = new Date(effectiveISO);
      if (!Number.isFinite(t.getTime())) continue;
      const dday = getDdayMeta(effectiveISO, now);
      if (dday.diff === null) continue;
      if (dday.diff < 0) continue;
      const meta = metaMap[s.index] ?? {};
      candidates.push({
        index: s.index,
        iso: effectiveISO,
        status: meta.status,
        badges: buildBadges(meta),
        percent: progressPercent(s.index),
        refundCompleted: refundCompletedIndex ? s.index === refundCompletedIndex : false,
        refundRequested: refundRequestedIndex ? s.index === refundRequestedIndex : false,
        lastClass: lastClassIndex ? s.index === lastClassIndex : false,
      });
    }

    return candidates.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime()).slice(0, 3);
  }, [student, sessions, token, baseDatesISO, metaMap, progressPercent, refundCompletedIndex, refundRequestedIndex]);

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

  useEffect(() => {
    if (!student) return;
    if (consultForm.purpose !== "pause_request" || consultForm.finalResult !== "pause_confirm") {
      if (consultForm.pauseRefundRatio !== "") {
        setConsultForm((prev) => ({ ...prev, pauseRefundRatio: "" }));
      }
      return;
    }
    if (!consultForm.pauseEffectiveDate) {
      if (consultForm.pauseRefundRatio !== "") {
        setConsultForm((prev) => ({ ...prev, pauseRefundRatio: "" }));
      }
      return;
    }

    const lastIdx = findClassIndexByDatePreferFuture({
      token,
      sessions,
      baseDatesISO,
      metaMap,
      targetDate: consultForm.pauseEffectiveDate,
    });
    if (!lastIdx) {
      if (consultForm.pauseRefundRatio !== "") {
        setConsultForm((prev) => ({ ...prev, pauseRefundRatio: "" }));
      }
      return;
    }

    const requestIndex = lastIdx + 1;
    const refundTarget = displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex);
    const nextRatio = refundTarget
      ? computeRefundRatio(refundTarget, requestIndex, Boolean(refundTarget.isBase))
      : "";

    if (consultForm.pauseRefundRatio !== nextRatio) {
      setConsultForm((prev) => ({ ...prev, pauseRefundRatio: nextRatio }));
    }
  }, [
    student,
    consultForm.purpose,
    consultForm.finalResult,
    consultForm.pauseEffectiveDate,
    consultForm.pauseRefundRatio,
    token,
    sessions,
    baseDatesISO,
    metaMap,
    displayRecords,
  ]);

  if (!mounted) return null;

  if (!token) {
    return (
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto"}}>
        <h1 className="page-title">학생 페이지</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>token이 없습니다.</p>
      </main>
    );
  }

  if (!student) {
    return (
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto"}}>
        <h1 className="page-title">학생 페이지</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
          학생을 찾지 못했습니다. <code>{token}</code>
        </p>
      </main>
    );
  }

  function closePaymentPanel() {
    setShowPaymentPanel(false);
    setEditingRecordId(null);
    setPaymentError("");
  }

  function openScheduleEdit() {
    if (!student) return;
    setScheduleError("");
    const baseDates = buildBaseDatesISO(student, 60);
    const localMetaMap = readMetaMap(token);
    let nextIndex = 0;
    const now = new Date();
    for (let i = 1; i <= currentCount; i++) {
      const { effectiveISO } = computeEffectiveISO({ token, index: i, baseDatesISO: baseDates, metaMap: localMetaMap });
      if (!effectiveISO) continue;
      const t = new Date(effectiveISO);
      if (Number.isFinite(t.getTime()) && t > now) {
        nextIndex = i;
        break;
      }
    }
    const startIdx = nextIndex > 0 ? nextIndex : Math.max(1, currentCount + 1);
    setScheduleStartIndex(startIdx);
    const { effectiveISO: startEffectiveISO } = computeEffectiveISO({
      token,
      index: startIdx,
      baseDatesISO: baseDates,
      metaMap: localMetaMap,
    });
    const startYmd = ymdFromISO_KST(startEffectiveISO ?? "");
    setScheduleStartDate(startYmd ?? "");

    const sortedChanges = [...(student.scheduleChangeEvents ?? [])].sort((a, b) => a.startIndex - b.startIndex);
    const today = todayYmdKST();
    let rules = [...(student.scheduleRules ?? [])];
    for (const ch of sortedChanges) {
      if (!Array.isArray(ch.newRules) || ch.newRules.length === 0) continue;
      if (ch.startDate && ch.startDate > today) continue;
      rules = [...ch.newRules];
    }
    setScheduleDays((prev) => {
      const next = { ...prev };
      for (const d of [0, 1, 2, 3, 4, 5, 6]) next[d] = { ...next[d], on: false };
      for (const r of rules) {
        next[r.weekday] = { on: true, hour: r.hour, minute: r.minute as 0 | 30 };
      }
      return next;
    });
    setScheduleEditOpen(true);
  }

  function closeScheduleEdit() {
    setScheduleEditOpen(false);
    setScheduleError("");
  }

  function toggleScheduleDay(d: number) {
    setScheduleDays((prev) => ({ ...prev, [d]: { ...prev[d], on: !prev[d].on } }));
  }

  function setScheduleHour(d: number, hour: number) {
    setScheduleDays((prev) => ({ ...prev, [d]: { ...prev[d], hour: normalizeHour(hour) } }));
  }

  function setScheduleMinute(d: number, minute: 0 | 30) {
    setScheduleDays((prev) => ({ ...prev, [d]: { ...prev[d], minute: normalizeMinute(minute) } }));
  }

  function saveScheduleChange() {
    if (!student) return;
    setScheduleError("");
    const computedStart = scheduleStartDate
      ? resolveScheduleStartIndexByDate(scheduleStartDate)
      : Number(scheduleStartIndex);
    const startIndex = Math.max(1, Math.floor(Number(computedStart)));
    if (!Number.isFinite(startIndex)) return setScheduleError("시작 회차를 입력해주세요.");

    const rules: ScheduleRule[] = [];
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      const it = scheduleDays[d];
      if (!it?.on) continue;
      rules.push({ weekday: d as Weekday, hour: it.hour, minute: it.minute });
    }
    if (rules.length === 0) return setScheduleError("수업 요일/시간을 최소 1개 선택해주세요.");

    const existing = (student?.scheduleChangeEvents ?? []).find((e) => e.startIndex === startIndex);
    if (existing) {
      const ok = confirm("이미 같은 회차의 시간 변경 기록이 있습니다. 새롭게 적용하시겠습니까?");
      if (!ok) return;
    }

    const nextEvents = (student?.scheduleChangeEvents ?? []).filter((e) => e.startIndex !== startIndex);
    const baseDates = buildBaseDatesISO(student, 120);
    const localMetaMap = readMetaMap(token);
    const { effectiveISO } = computeEffectiveISO({
      token,
      index: startIndex,
      baseDatesISO: baseDates,
      metaMap: localMetaMap,
    });
    const fallbackStartDate = ymdFromISO_KST(effectiveISO ?? "");
    const normalizedStartDate = (scheduleStartDate || fallbackStartDate || "").trim();

    nextEvents.push({
      id: makeId(),
      startIndex,
      startDate: normalizedStartDate || undefined,
      newRules: rules,
      createdAt: nowIso(),
    });
    nextEvents.sort((a, b) => a.startIndex - b.startIndex);

    upsertStudent({ ...student, scheduleChangeEvents: nextEvents });
    syncSessionDisplayAtByToken(token);
    setRefreshTick((x) => x + 1);
    closeScheduleEdit();
  }
  function openEditPayment(record: PaymentRecord) {
    setEditingRecordId(record.id);
    setPaymentConfirmed(true);
    setPaymentMemo(record.memo ?? "");
    setAddedCount(record.addedCount);
    setPaymentDate(record.paymentDate);
    setShowPaymentPanel(true);
  }

  function closeRefundPanel() {
    setRefundOpen(false);
    setRefundRecordId(null);
    setRefundError("");
    setRefundConfirmed(false);
    setRefundConsultInput("");
    setRefundReasonInput("");
    setRefundSessionInput(0);
    setRefundMode("request");
  }

  function openConsultNew(purpose: "general" | "pause_request" | "extension" = "general") {
    setConsultEditingId(null);
    setConsultForm({
      date: todayYmdKST(),
      purpose,
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
    setConsultError("");
    setConsultOpen(true);
  }

  function openConsultEdit(record: ConsultationRecord) {
    setConsultEditingId(record.id);
    setConsultForm({
      date: record.date || todayYmdKST(),
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
  }

  function openConsultForSession(tag: { recordId: string } | null) {
    if (tag?.recordId) {
      const record = consultRecords.find((r) => r.id === tag.recordId);
      if (record) {
        openConsultEdit(record);
        return;
      }
    }
    openConsultNew();
  }

  function saveConsultRecord() {
    if (!student) return;
    const err = validateConsultForm(consultForm, isAdmin);
    if (err) return setConsultError(err);
    const list = consultRecords ?? [];
    const { previous: existing, next, updated } = buildConsultationRecord({
      records: list,
      editingId: consultEditingId,
      form: consultForm,
      nowIso: nowIso(),
      makeId,
    });

    const wantsExtended = consultForm.purpose === "extension" && consultForm.extensionResult === "extended";
    const paymentConfirmed = Boolean(consultForm.extensionPaymentConfirmed);
    const prevApplied = Boolean(existing?.extensionAppliedAt && existing?.extensionPaymentRecordId);

    let nextConsultRecords = updated;
    if (!wantsExtended || !paymentConfirmed) {
      nextConsultRecords = updated.map((r) =>
        r.id === next.id ? { ...r, extensionAppliedAt: undefined, extensionPaymentRecordId: undefined } : r
      );
    }

    if (isAdmin && consultForm.purpose === "pause_request") {
      if (consultForm.finalResult === "pause_confirm" && consultForm.pauseEffectiveDate) {
        const lastYmd = consultForm.pauseEffectiveDate;
        const lastIdx = findClassIndexByDatePreferFuture({
          token,
          sessions,
          baseDatesISO,
          metaMap,
          targetDate: lastYmd,
        });
        const requestIndex = lastIdx ? lastIdx + 1 : null;
        const refundTarget =
          requestIndex !== null
            ? displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex)
            : undefined;
        const pauseRefundRatio = refundTarget
          ? computeRefundRatio(refundTarget, requestIndex as number, Boolean(refundTarget.isBase))
          : undefined;

        nextConsultRecords = nextConsultRecords.map((r) =>
          r.id === next.id
            ? {
                ...r,
                pauseEffectiveDate: lastYmd,
                pauseRefundRatio,
                pauseRefundCompleted: Boolean(consultForm.pauseRefundCompleted),
              }
            : r
        );

        const today = todayYmdKST();
        const pauseStatus = computePauseLifecycle(today, lastYmd) === "paused" ? "paused" : "confirmed";
        upsertStudent({
          ...student,
          status: "paused",
          pauseEffectiveDate: lastYmd,
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

    saveConsultationsByStudent(student.id, nextConsultRecords);
    setConsultRecords(nextConsultRecords);
    setConsultOpen(false);

    if (isAdmin && prevApplied && (!wantsExtended || !paymentConfirmed) && existing?.extensionPaymentRecordId) {
      const nextHistory = history.filter((h) => h.id !== existing.extensionPaymentRecordId);
      applyHistory(nextHistory, undefined, false);
    }

    if (isAdmin && wantsExtended && paymentConfirmed) {
      const cnt = Math.max(1, Math.floor(Number(consultForm.extensionAddedCount) || 0));
      const nextPaymentDate = consultForm.extensionPaymentDate;
      const nextMemo = consultForm.content.trim() || "연장 상담";

      if (prevApplied && existing?.extensionPaymentRecordId) {
        const recId = existing.extensionPaymentRecordId;
        const recIdx = history.findIndex((h) => h.id === recId);

        if (recIdx >= 0) {
          const prev = history[recIdx];
          const patched: PaymentRecord = {
            ...prev,
            paymentDate: nextPaymentDate,
            addedCount: cnt,
            memo: nextMemo,
          };
          const nextHistory = history.map((h, i) => (i === recIdx ? patched : h));
          applyHistory(nextHistory, undefined, false);

          const refreshed = loadConsultationsByStudent(student.id).map((r) =>
            r.id === next.id
              ? {
                  ...r,
                  extensionAppliedAt: r.extensionAppliedAt ?? existing.extensionAppliedAt ?? nowIso(),
                  extensionPaymentRecordId: recId,
                }
              : r
          );
          saveConsultationsByStudent(student.id, refreshed);
          setConsultRecords(refreshed);
        } else {
          // 연결된 결제기록이 유실된 경우: 신규 생성으로 복구
          const paymentRecord: PaymentRecord = {
            id: makeId(),
            paymentDate: nextPaymentDate,
            addedCount: cnt,
            startIndex: 0,
            endIndex: 0,
            memo: nextMemo,
            createdAt: nowIso(),
          };
          const nextHistory = [...history, paymentRecord];
          applyHistory(nextHistory, undefined, false);

          const refreshed = loadConsultationsByStudent(student.id).map((r) =>
            r.id === next.id ? { ...r, extensionAppliedAt: nowIso(), extensionPaymentRecordId: paymentRecord.id } : r
          );
          saveConsultationsByStudent(student.id, refreshed);
          setConsultRecords(refreshed);
        }
      } else {
        const paymentRecord: PaymentRecord = {
          id: makeId(),
          paymentDate: nextPaymentDate,
          addedCount: cnt,
          startIndex: 0,
          endIndex: 0,
          memo: nextMemo,
          createdAt: nowIso(),
        };
        const nextHistory = [...history, paymentRecord];
        applyHistory(nextHistory, undefined, false);

        const refreshed = loadConsultationsByStudent(student.id).map((r) =>
          r.id === next.id ? { ...r, extensionAppliedAt: nowIso(), extensionPaymentRecordId: paymentRecord.id } : r
        );
        saveConsultationsByStudent(student.id, refreshed);
        setConsultRecords(refreshed);
      }
    }

  }

  function deleteConsultRecord() {
    if (!student || !consultEditingId) return;
    const list = consultRecords ?? [];
    const deleting = list.find((r) => r.id === consultEditingId);
    const updated = list.filter((r) => r.id !== consultEditingId);
    saveConsultationsByStudent(student.id, updated);
    setConsultRecords(updated);

    if (deleting?.purpose === "extension" && deleting.extensionPaymentRecordId) {
      const nextHistory = history.filter((h) => h.id !== deleting.extensionPaymentRecordId);
      applyHistory(nextHistory);
    }
    if (isAdmin && deleting?.purpose === "pause_request") {
      applyPauseStateFromConsultations(student, updated);
    }

    setConsultOpen(false);
  }

  function onSubmitRefundRequest() {
    if (!refundRecordId) return;
    setRefundError("");

    const record = refundRecord;
    if (!record) return;

    const req = Math.floor(Number(refundSessionInput));
    if (!Number.isFinite(req)) return setRefundError("환불 요청 회차를 입력해주세요.");
    if (req < record.startIndex || req > record.endIndex) {
      return setRefundError("환불 요청 회차는 해당 연장 구간 안이어야 합니다.");
    }
    if (!refundReasonInput.trim()) return setRefundError("환불 예상 사유를 입력해주세요.");

    const ratio = computeRefundRatio(record, req, Boolean(record.isBase));
    if (record.isBase) {
      applyHistory(
        history,
        {
        baseRefundStatus: "requested",
        baseRefundSessionIndex: req,
        baseRefundRatio: ratio,
        baseRefundReason: refundReasonInput.trim(),
        baseRefundRequestedAt: nowIso(),
        },
        true
      );
    } else {
      const nextHistory = history.map((h) =>
        h.id === record.id
          ? {
              ...h,
              refundStatus: "requested" as const,
              refundSessionIndex: req,
              refundRatio: ratio,
              refundReason: refundReasonInput.trim(),
              refundRequestedAt: nowIso(),
            }
          : h
      );
      applyHistory(nextHistory, undefined, true);
    }
    closeRefundPanel();
  }

  function onSubmitRefundProcess() {
    if (!refundRecordId) return;
    setRefundError("");

    const record = refundRecord;
    if (!record) return;
    const req = Math.floor(Number(refundSessionInput));
    if (!Number.isFinite(req)) return setRefundError("환불 요청 회차를 입력해주세요.");
    if (req < record.startIndex || req > record.endIndex) {
      return setRefundError("환불 요청 회차는 해당 연장 구간 안이어야 합니다.");
    }
    if (!refundReasonInput.trim()) return setRefundError("환불 예상 사유를 입력해주세요.");
    if (!refundConsultInput.trim()) return setRefundError("상담 내용을 입력해주세요.");
    if (!refundProcessedDate) return setRefundError("환불 처리 날짜를 입력해주세요.");
    if (!refundConfirmed) return setRefundError("환불 처리 완료를 체크해주세요.");

    if (record.isBase) {
      const ratio = computeRefundRatio(record, req, Boolean(record.isBase));
      applyHistory(
        history,
        {
          baseRefundStatus: "completed",
          baseRefundSessionIndex: req,
          baseRefundRatio: ratio,
          baseRefundReason: refundReasonInput.trim(),
          baseRefundRequestedAt: record.refundRequestedAt ?? nowIso(),
          baseRefundConsultNote: refundConsultInput.trim(),
          baseRefundProcessedDate: refundProcessedDate,
          baseRefundProcessedAt: nowIso(),
        },
        true
      );
    } else {
      const ratio = computeRefundRatio(record, req, Boolean(record.isBase));
      const nextHistory = history.map((h) =>
        h.id === record.id
          ? {
              ...h,
              refundStatus: "completed" as const,
              refundSessionIndex: req,
              refundRatio: ratio,
              refundReason: refundReasonInput.trim(),
              refundRequestedAt: h.refundRequestedAt ?? nowIso(),
              refundConsultNote: refundConsultInput.trim(),
              refundProcessedDate,
              refundProcessedAt: nowIso(),
            }
          : h
      );
      applyHistory(nextHistory, undefined, true);
    }
    closeRefundPanel();
  }

  function onCancelRefundRequest() {
    if (!refundRecordId) return;
    const record = refundRecord;
    if (!record) return;
    if (record.isBase) {
      applyHistory(
        history,
        {
        baseRefundStatus: undefined,
        baseRefundSessionIndex: undefined,
        baseRefundRatio: undefined,
        baseRefundReason: undefined,
        baseRefundRequestedAt: undefined,
        baseRefundProcessedAt: undefined,
        baseRefundProcessedDate: undefined,
        baseRefundConsultNote: undefined,
        },
        true
      );
    } else {
      const nextHistory = history.map((h) =>
        h.id === record.id
          ? {
              ...h,
              refundStatus: undefined,
              refundSessionIndex: undefined,
              refundRatio: undefined,
              refundReason: undefined,
              refundRequestedAt: undefined,
              refundProcessedAt: undefined,
              refundProcessedDate: undefined,
              refundConsultNote: undefined,
            }
          : h
      );
      applyHistory(nextHistory, undefined, true);
    }
    closeRefundPanel();
  }

  function applyHistory(records: PaymentRecord[], basePatch?: Partial<Student>, skipSessions = false) {
    if (!student) return;
    const normalized = normalizePaymentHistoryRanges(records, baseCount);
    const nextTotal = baseCount + normalized.reduce((sum, r) => sum + r.addedCount, 0);
    const updatedStudent = {
      ...student,
      ...basePatch,
      planCount: nextTotal,
      paymentHistory: normalized,
    } as Student;

    upsertStudent(updatedStudent);

    if (skipSessions) {
      setRefreshTick((x) => x + 1);
      return;
    }

    const all = loadSessions();
    const prevStudentSessions = all.filter((s) => s.studentId === updatedStudent.id);
    const prevMaxIndex = prevStudentSessions.reduce((m, s) => Math.max(m, s.index), 0);
    const kept = all.filter((s) => s.studentId !== updatedStudent.id || s.index <= nextTotal);
    saveSessions(kept);

    const maxIndex = kept
      .filter((s) => s.studentId === updatedStudent.id)
      .reduce((m, s) => Math.max(m, s.index), 0);

    if (nextTotal > maxIndex) {
      const existing = kept
        .filter((s) => s.studentId === updatedStudent.id)
        .sort((a, b) => a.index - b.index);
      let lastISO = existing.length > 0 ? existing[existing.length - 1].displayAt : null;

      for (let idx = maxIndex + 1; idx <= nextTotal; idx++) {
        const rules = rulesForIndex(updatedStudent, idx);
        const ownerRecord = normalized.find((r) => idx >= r.startIndex && idx <= r.endIndex);

        // 결제일이 마지막 회차를 지난 경우: 결제일(당일/이후 첫 수업)부터 시작
        let displayAt: string | null = null;
        if (ownerRecord && idx === ownerRecord.startIndex && ownerRecord.paymentDate) {
          const lastYmd = lastISO ? ymdFromISO_KST(lastISO) : null;
          if (!lastYmd || ownerRecord.paymentDate > lastYmd) {
            displayAt = nextIsoFromRules({
              rules,
              fromYmd: ownerRecord.paymentDate,
            });
          }
        }

        if (!displayAt) {
          if (lastISO) {
            displayAt = nextIsoFromRules({ rules, afterISO: lastISO });
          } else {
            const baseDatesISO = buildBaseDatesISO(updatedStudent, 0);
            displayAt = baseDatesISO[idx - 1] ?? null;
          }
        }

        if (!displayAt) displayAt = new Date().toISOString();
        const sess: Session = {
          id: makeId(),
          studentId: updatedStudent.id,
          index: idx,
          displayAt,
          state: "normal",
          createdAt: nowIso(),
        };
        upsertSession(sess);
        lastISO = displayAt;
      }
    }

    // 연장 회차(기본 회차 이후)는 결제일 규칙을 반영하기 위해 override를 고정한다.
    // - 결제일이 마지막 회차를 넘기면 결제일(당일/이후 첫 수업)부터 시작
    // - 아니면 직전 회차 다음 수업으로 연결
    const sessionsNow = sessionsByStudent(updatedStudent.id);
    const byIndex = new Map(sessionsNow.map((s) => [s.index, s]));
    let cursorISO = byIndex.get(baseCount)?.displayAt ?? null;

    for (const rec of normalized) {
      if (!Number.isFinite(rec.startIndex) || !Number.isFinite(rec.endIndex) || rec.addedCount <= 0) continue;
      const rules = rulesForIndex(updatedStudent, rec.startIndex);
      let startISO: string | null = null;
      if (cursorISO) {
        const lastYmd = ymdFromISO_KST(cursorISO);
        if (rec.paymentDate && lastYmd && rec.paymentDate > lastYmd) {
          startISO = nextIsoFromRules({ rules, fromYmd: rec.paymentDate });
        } else {
          startISO = nextIsoFromRules({ rules, afterISO: cursorISO });
        }
      } else {
        startISO = nextIsoFromRules({ rules, fromYmd: rec.paymentDate || updatedStudent.startDate });
      }
      if (!startISO) continue;

      let iso = startISO;
      for (let idx = rec.startIndex; idx <= rec.endIndex; idx++) {
        const ymd = ymdFromISO_KST(iso);
        const hm = hmFromISO_KST(iso);
        if (ymd && hm) {
          upsertMeta(token, idx, {
            overrideDate: ymd,
            overrideHour: hm.hour,
            overrideMinute: hm.minute,
          });
        }
        const nextRules = rulesForIndex(updatedStudent, idx + 1);
        const next = nextIsoFromRules({ rules: nextRules, afterISO: iso });
        if (!next) break;
        iso = next;
      }
      cursorISO = iso;
    }

    // 줄어든 구간의 override는 비운다.
    for (let idx = nextTotal + 1; idx <= prevMaxIndex; idx++) {
      upsertMeta(token, idx, { overrideDate: "", overrideHour: null, overrideMinute: null });
    }

    // 저장된 세션 displayAt도 최종 계산값으로 동기화해서
    // 화면/저장소가 같은 날짜를 바라보게 한다.
    const syncedMetaMap = readMetaMap(token);
    const syncedBaseDates = buildBaseDatesISO(updatedStudent, 60);
    const syncedAll = loadSessions().map((s) => {
      if (s.studentId !== updatedStudent.id) return s;
      const { effectiveISO } = computeEffectiveISO({
        token,
        index: s.index,
        baseDatesISO: syncedBaseDates,
        metaMap: syncedMetaMap,
      });
      if (!effectiveISO) return s;
      return { ...s, displayAt: effectiveISO };
    });
    saveSessions(syncedAll);

    setRefreshTick((x) => x + 1);
  }

  function onApplyPayment() {
    if (!isAdmin) return;
    setPaymentError("");

    const cnt = Math.floor(Number(addedCount));
    if (!paymentConfirmed) return setPaymentError("결제 확인을 먼저 체크해주세요.");
    if (!paymentDate) return setPaymentError("결제일을 입력해주세요.");
    if (!Number.isFinite(cnt) || cnt <= 0) return setPaymentError("추가 회차는 1 이상 숫자여야 합니다.");

    const record: PaymentRecord = {
      id: editingRecordId ?? makeId(),
      paymentDate,
      addedCount: cnt,
      startIndex: 0,
      endIndex: 0,
      memo: paymentMemo.trim() ? paymentMemo.trim() : undefined,
      createdAt: editingRecordId
        ? history.find((h) => h.id === editingRecordId)?.createdAt ?? nowIso()
        : nowIso(),
    };

    const nextHistory = editingRecordId
      ? history.map((h) => (h.id === editingRecordId ? record : h))
      : [...history, record];

    applyHistory(nextHistory);

    setPaymentConfirmed(false);
    setPaymentMemo("");
    setAddedCount(12);
    setPaymentDate(todayYmdKST());
    setShowPaymentPanel(false);
    setEditingRecordId(null);
  }

  function onDeletePaymentRecord() {
    if (!editingRecordId) return;
    const nextHistory = history.filter((h) => h.id !== editingRecordId);
    applyHistory(nextHistory);
    setPaymentConfirmed(false);
    setPaymentMemo("");
    setAddedCount(12);
    setPaymentDate(todayYmdKST());
    setShowPaymentPanel(false);
    setEditingRecordId(null);
  }

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto"}}>
      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {backToTmain ? (
          <div style={{ width: "100%", marginBottom: 8 }}>
            <button onClick={() => router.push(backToTmain)} className="btn btn-bold">
              학생 관리
            </button>
          </div>
        ) : null}
        <div style={{ width: "100%" }}>
          <h1 className="page-title" style={{ textAlign: "center" }}>
            {student?.name ?? "-"} 학생 정보
          </h1>
        </div>
      </section>

      <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: accessRole === "s" ? "140px 1fr" : "140px 1fr 140px 1fr",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 900 }}>학생 이름</div>
            <div style={{ fontWeight: 900, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {student?.name ?? "-"}
              {accessRole !== "s" ? (
                <Badge style={{ background: studentStatusView.bg, color: studentStatusView.color }}>
                  {studentStatusView.label}
                </Badge>
              ) : null}
            </div>
            {accessRole !== "s" ? (
              <>
                <div style={{ fontWeight: 900 }}>학생 기수</div>
                <div>{String(student?.cohort ?? "-")}</div>
              </>
            ) : null}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr 140px 1fr",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 900 }}>학생 이메일</div>
            <div>{student?.googleEmail ?? "-"}</div>
            <div style={{ fontWeight: 900 }}>학생 전화번호</div>
            <div>{formatPhone(student?.studentPhone ?? "")}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>담당 선생님</div>
            <div>{teacherName}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>선생님 이메일</div>
            <div>{teacherEmail}</div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: accessRole === "s" ? "140px 1fr" : "140px 1fr 140px 1fr",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 900 }}>학교 및 학년</div>
            <div>
              {String(student?.school ?? "-").trim()} · {formatGrade(student?.grade)}
            </div>
            {showParentPhone ? (
              <>
                <div>
                  <span style={{ fontWeight: 900 }}>학부모 연락처</span>
                  {parentRoleLabel !== "-" ? ` (${parentRoleLabel})` : ""}
                </div>
                <div>{formatPhone(student?.parentPhone ?? "")}</div>
              </>
            ) : null}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900 }}>수업 시간</div>
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
              {currentScheduleText}
            </div>
          </div>

        </div>
      </section>

      <section
        style={{
          marginTop: 12,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        {canEdit ? (
          <button onClick={() => router.push(editHref)} className="btn" title="선생님/관리자만">
            정보 편집
          </button>
        ) : null}

        {canEdit ? (
          <button onClick={openScheduleEdit} className="btn" title="선생님/관리자만">
            시간 변경
          </button>
        ) : null}

        {canEdit ? (
          <button className="btn btn-bold" onClick={() => openConsultNew("general")}>
            일반 상담
          </button>
        ) : null}

        <button onClick={() => router.push(sessionListHref)} className="btn btn-green">
          수업 목록
        </button>

        {isAdmin ? (
          <button onClick={() => openConsultNew("extension")} className="btn btn-blue" title="연장 요청">
            연장 요청
          </button>
        ) : null}

        {canEdit ? (
          <button
            className="btn btn-orange"
            title="휴회 요청"
            onClick={() => openConsultNew("pause_request")}
          >
            휴회 요청
          </button>
        ) : null}
      </section>

      <section style={{ marginTop: 12, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
        <div className="card-title">예정 수업</div>
        {upcomingSessions.length === 0 ? (
          <div className="text-muted" style={{ marginTop: 8 }}>
            예정 수업이 없습니다. 수업 목록을 확인하세요.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {upcomingSessions.map((item) => {
              const consultTag = pickPrimaryConsultTag(consultMap[item.index]);
              return (
                <div
                  key={`${item.index}-${item.iso}`}
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
                  <div
                    onClick={() => router.push(`${sessionListHref}/${item.index}`)}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 1fr",
                      gap: 30,
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {(() => {
                        const dday = getDdayMeta(item.iso, new Date());
                        if (!dday || dday.diff === null) return null;
                        return <Badge className={`text-white ${dday.className}`}>{dday.label}</Badge>;
                      })()}
                      <span>{item.index}회차</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <div>{fmtKST_yyyyMMdd_HHmm_noSeconds(item.iso)}</div>
                      <Badge style={getAchievementBadgeStyle(item.percent)}>{item.percent}%</Badge>
                      {item.refundCompleted ? (
                        <Badge style={{ background: "#fecaca", color: "#9f1239" }}>환불완료</Badge>
                      ) : item.refundRequested ? (
                        <Badge style={{ background: "#fed7aa", color: "#9a3412" }}>환불요청</Badge>
                      ) : null}
                      {(() => {
                        const statusLabel = item.status === "present" ? "출석" : item.status === "absent" ? "결석" : "예정";
                        const style = getStatusStyle(item.status as "present" | "absent" | "planned");
                        return <Badge style={{ background: style.bg, color: style.text }}>{statusLabel}</Badge>;
                      })()}
                      {item.lastClass ? (
                        <Badge style={{ background: "#ef4444", color: "#fff" }}>마지막 수업</Badge>
                      ) : null}
                      {item.badges.map((badge) => (
                        <Badge key={`${item.index}:${badge}`} style={{ background: "#f1f5f9", color: "#334155" }}>
                          {badge}
                        </Badge>
                      ))}
                      {accessRole !== "s" &&
                      !(
                        item.lastClass &&
                        consultTag &&
                        consultTag.label === "휴회 예정"
                      ) ? (
                        <ConsultBadge tag={consultTag} />
                      ) : null}
                    </div>
                  </div>
                  <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6 }}>
                    <SessionQuickActions role={accessRole} token={token} index={item.index} />
                    {accessRole !== "s" ? (
                      <ConsultButton tag={consultTag} onClick={() => openConsultForSession(consultTag)} />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {student?.scheduleChangeEvents?.length ? (
        <section style={{ marginTop: 12, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
          <div className="card-title">시간 변경 기록</div>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {[...student.scheduleChangeEvents]
              .sort((a, b) => a.startIndex - b.startIndex)
              .map((e) => (
                <div
                  key={e.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    background: "var(--surface-bg)",
                  }}
                >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "110px 90px 1fr",
                        gap: 30,
                        flex: "1 1 auto",
                        alignItems: "center",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{formatYmdDot(e.createdAt?.slice(0, 10))}</div>
                    <div>{e.startDate ? `${formatYmdDot(e.startDate)}부터` : `${e.startIndex}회차부터`}</div>
                    <div style={{ color: "#374151" }}>{formatSchedule(e.newRules)}</div>
                  </div>
                  {canEdit ? (
                    <button
                      onClick={() => {
                        const ok = confirm("이 시간 변경 기록을 삭제하시겠습니까?");
                        if (!ok) return;
                        const nextEvents = (student?.scheduleChangeEvents ?? []).filter((x) => x.id !== e.id);
                        upsertStudent({ ...student, scheduleChangeEvents: nextEvents });
                        syncSessionDisplayAtByToken(token);
                        setRefreshTick((x) => x + 1);
                      }}
                      className="btn btn-bold"
                    >
                      삭제
                    </button>
                  ) : null}
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section style={{ marginTop: 12, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
          <div className="card-title">상담 기록</div>
          {consultRecords.length === 0 ? (
            <div className="text-muted" style={{ marginTop: 8 }}>
              상담 기록이 없습니다.
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {consultRecords.map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "110px 140px 120px 140px 120px auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    background: "var(--surface-bg)",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{formatYmdDot(r.date)}</div>
                  <div>
                    <Badge
                      className={
                        r.purpose === "pause_request"
                          ? "bg-orange-200 text-orange-900"
                          : r.purpose === "extension" && r.extensionResult === "extended"
                            ? "bg-blue-600 text-white"
                            : r.purpose === "extension" && r.extensionResult === "not_extended"
                              ? "bg-red-500 text-white"
                              : "bg-slate-200 text-slate-700"
                      }
                    >
                      {r.purpose === "pause_request"
                        ? "휴회 요청"
                        : r.purpose === "extension"
                          ? r.extensionResult === "extended"
                            ? "연장 요청"
                            : r.extensionResult === "not_extended"
                              ? "미연장"
                              : "연장 상담"
                          : "일반 상담"}
                    </Badge>
                  </div>
                  <div style={{ fontWeight: 700 }}>
                    {r.purpose === "extension" && r.extensionResult === "extended"
                      ? formatYmdDot(r.extensionPaymentDate)
                      : r.purpose === "pause_request"
                        ? formatYmdDot(r.adminConsultDate ?? r.pauseEffectiveDate)
                        : ""}
                  </div>
                  <div>
                    {r.purpose === "extension" && r.extensionResult === "extended" ? (
                      <Badge tone={r.extensionPaymentConfirmed ? "blue" : "orange"}>
                        {r.extensionPaymentConfirmed ? "결제 완료" : "결제 예정"}
                      </Badge>
                    ) : r.purpose === "pause_request" && r.finalResult ? (
                      <Badge
                        className={
                          r.finalResult === "pause_cancel"
                            ? "bg-orange-200 text-orange-900"
                            : "bg-red-500 text-white"
                        }
                      >
                        {r.finalResult === "pause_cancel" ? "휴회 취소" : "휴회 확정"}
                      </Badge>
                    ) : (
                      ""
                    )}
                  </div>
                  <div>
                    {r.purpose === "pause_request" && r.finalResult === "pause_confirm" ? (
                      <Badge tone={r.pauseRefundCompleted ? "red" : "orange"}>
                        {r.pauseRefundCompleted ? "환불 완료" : "환불 예정"}
                      </Badge>
                    ) : (
                      ""
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    {(() => {
                      const tag: ConsultTag =
                        r.purpose === "general"
                          ? {
                              purpose: "general",
                              target: "student",
                              label: "",
                              badgeClassName: "",
                              buttonClassName: "btn btn-gray",
                              recordId: r.id,
                            }
                          : r.purpose === "extension"
                            ? {
                                purpose: "extension",
                                target: "student",
                                label: "",
                                badgeClassName: "",
                                buttonClassName:
                                  r.extensionResult === "extended"
                                    ? "btn btn-blue"
                                    : r.extensionResult === "not_extended"
                                      ? "btn btn-red"
                                      : "btn btn-gray",
                                recordId: r.id,
                              }
                          : {
                              purpose: "pause_request",
                              target: "student",
                              label: "",
                              badgeClassName: "",
                              buttonClassName: r.finalResult === "pause_confirm" ? "btn btn-red" : "btn btn-orange",
                              recordId: r.id,
                            };
                      return <ConsultButton tag={tag} onClick={() => openConsultEdit(r)} />;
                    })()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {isAdmin || accessRole === "t" ? (
        <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div className="card-title">결제 기록</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {isAdmin ? (
                <button
                  className="btn btn-bold"
                  title="수정 모드"
                  onClick={() => setActionMode((prev) => (prev === "edit" ? null : "edit"))}
                >
                  수정
                </button>
              ) : null}
            </div>
          </div>
          {displayRecords.length === 0 ? (
            <div style={{ color: "var(--text-muted)", marginTop: 6 }}>기록이 없습니다.</div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              {displayRecords.map((h) => (
                <div
                  key={h.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    background: "var(--surface-bg)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "110px 90px 1fr",
                      gap: 30,
                      flex: "1 1 auto",
                    alignItems: "center",
                  }}
                  >
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatYmdDot(h.paymentDate)}</div>
                    <div style={{ whiteSpace: "nowrap" }}>+{h.addedCount}회</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "#374151" }}>
                      <span>
                        {h.startIndex}회차 ~ {h.endIndex}회차
                      </span>
                      {h.refundStatus ? (
                      <Badge
                        style={{
                          background: h.refundStatus === "completed" ? "#fecaca" : "#fed7aa",
                          color: "#9a3412",
                        }}
                      >
                        {h.refundStatus === "completed" ? "환불완료" : "환불요청"} · {h.refundSessionIndex ?? "-"}회차
                        {` · ${refundRatioLabel(h.refundRatio)}`}
                      </Badge>
                    ) : null}
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flex: "0 0 auto" }}>
                    {actionMode === "edit" && isAdmin && !h.isBase ? (
                      <button onClick={() => openEditPayment(h)} className="btn btn-bold" title="수정">
                        수정
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {isAdmin && showPaymentPanel ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 350,
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 900 }}>
                {editingRecordId ? "수업 현황 수정" : "추가 결제 등록"}
              </div>
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>결제일</div>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>추가회차</div>
                <input
                  type="number"
                  min={1}
                  value={addedCount}
                  onChange={(e) => setAddedCount(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>

              <div style={{ color: "var(--text-muted)" }}>
                적용 회차 :{" "}
                {Number.isFinite(editingRange.end) && editingRange.end >= editingRange.start
                  ? `${editingRange.start}회차 ~ ${editingRange.end}회차`
                  : "-"}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800 }}>메모</div>
                <AutoResizeTextarea
                  rows={2}
                  value={paymentMemo}
                  placeholder="환불/결제 메모"
                  onChange={(e) => setPaymentMemo(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ height: 6 }} />

              <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>결제를 확인하셨습니까?</span>
                <input
                  type="checkbox"
                  checked={paymentConfirmed}
                  onChange={(e) => setPaymentConfirmed(e.target.checked)}
                />
              </label>

              {paymentError ? <div style={{ color: "#dc2626"}}>{paymentError}</div> : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                {editingRecordId ? (
                  <button
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#b91c1c")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#dc2626")}
                    onClick={onDeletePaymentRecord}
                    style={{ ...boxButton, padding: "10px 14px", fontWeight: 800, color: "#fff", background: "#dc2626" }}
                  >
                    삭제
                  </button>
                ) : null}
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={closePaymentPanel}
                  style={{ ...boxButton, padding: "10px 14px" }}
                >
                  취소
                </button>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={onApplyPayment}
                  style={{ ...boxButton, padding: "10px 14px", fontWeight: 800 }}
                >
                  {editingRecordId ? "저장" : "추가"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {refundOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 60,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 380,
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 900 }}>
              {refundMode === "process" ? "환불 처리" : "환불 요청"}
            </div>

            {refundMode === "process" ? (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>환불 회차</div>
                  <input
                    type="number"
                    value={refundSessionInput}
                    onChange={(e) => setRefundSessionInput(Number(e.target.value))}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800 }}>환불 예상 사유</div>
                  <AutoResizeTextarea
                    rows={2}
                    value={refundReasonInput}
                    onChange={(e) => setRefundReasonInput(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800 }}>상담 내용</div>
                  <AutoResizeTextarea
                    rows={2}
                    value={refundConsultInput}
                    onChange={(e) => setRefundConsultInput(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>처리 날짜</div>
                  <input
                    type="date"
                    value={refundProcessedDate}
                    onChange={(e) => setRefundProcessedDate(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span>환불 처리 완료</span>
                  <input
                    type="checkbox"
                    checked={refundConfirmed}
                    onChange={(e) => setRefundConfirmed(e.target.checked)}
                  />
                </label>

                {refundError ? <div style={{ color: "#dc2626"}}>{refundError}</div> : null}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                    onClick={closeRefundPanel}
                    style={{ ...boxButton, padding: "8px 12px" }}
                  >
                    취소
                  </button>
                  <button
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                    onClick={onCancelRefundRequest}
                    style={{ ...boxButton, padding: "8px 12px" }}
                  >
                    환불 취소
                  </button>
                  <button
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#dc2626")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#ef4444")}
                    onClick={onSubmitRefundProcess}
                    style={{
                      ...boxButton,
                      padding: "8px 12px",
                      fontWeight: 700,
                      border: "1px solid #dc2626",
                      background: "#ef4444",
                      color: "#fff",
                    }}
                  >
                    환불 처리 완료
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 800 }}>환불 회차</div>
                  <input
                    type="number"
                    value={refundSessionInput}
                    onChange={(e) => setRefundSessionInput(Number(e.target.value))}
                    style={inputStyle}
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 800 }}>환불 예상 사유</div>
                  <AutoResizeTextarea
                    rows={2}
                    value={refundReasonInput}
                    onChange={(e) => setRefundReasonInput(e.target.value)}
                    style={inputStyle}
                  />
                </div>

                {refundError ? <div style={{ color: "#dc2626"}}>{refundError}</div> : null}

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                    onClick={closeRefundPanel}
                    style={{ ...boxButton, padding: "8px 12px" }}
                  >
                    취소
                  </button>
                  <button
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#e67e00")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#ff8a00")}
                    onClick={onSubmitRefundRequest}
                    style={{
                      ...boxButton,
                      padding: "8px 12px",
                      fontWeight: 600,
                      color: "#fff",
                      background: "#ff8a00",
                    }}
                  >
                    환불 요청
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      <ConsultModal
        open={consultOpen}
        role={accessRole}
        state={consultForm}
        error={consultError}
        onChange={setConsultForm}
        onClose={() => setConsultOpen(false)}
        onSave={saveConsultRecord}
        onDelete={consultEditingId ? deleteConsultRecord : undefined}
      />

      {scheduleEditOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 70,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 420,
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 900 }}>수업 시간 변경</div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>시작 날짜</div>
                <input
                  type="date"
                  value={scheduleStartDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setScheduleStartDate(v);
                    if (!v) return;
                    setScheduleStartIndex(resolveScheduleStartIndexByDate(v));
                  }}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>시작 회차</div>
                <input
                  type="number"
                  min={1}
                  value={scheduleStartIndex}
                  onChange={(e) => setScheduleStartIndex(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontWeight: 800 }}>새 시간표</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[0, 1, 2, 3, 4, 5, 6].map((d) => {
                    const on = scheduleDays[d]?.on;
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleScheduleDay(d)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: on ? "1px solid #2563eb" : "1px solid var(--control-border)",
                          background: on ? "#2563eb" : "var(--surface-bg)",
                          color: on ? "#fff" : "var(--foreground)",
                        }}
                        aria-pressed={on}
                      >
                        {weekdayLabel(d)}
                      </button>
                    );
                  })}
                </div>

                <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  {[0, 1, 2, 3, 4, 5, 6]
                    .filter((d) => scheduleDays[d]?.on)
                    .map((d) => (
                      <div key={d} style={{ padding: 8, border: "1px solid var(--surface-border)", borderRadius: 8, background: "var(--surface-bg)" }}>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(180px, 50%) 1fr 1fr",
                            gap: 10,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ fontWeight: 800 }}>{weekdayLabel(d)}요일</div>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            step={1}
                            value={scheduleDays[d].hour}
                            onChange={(e) => setScheduleHour(d, Number(e.target.value))}
                            style={selectStyle}
                          />

                          <input
                            type="number"
                            min={0}
                            max={30}
                            step={30}
                            value={scheduleDays[d].minute}
                            onChange={(e) => {
                              setScheduleMinute(d, normalizeMinute(Number(e.target.value)));
                            }}
                            style={selectStyle}
                          />
                        </div>
                      </div>
                    ))}

                  {[0, 1, 2, 3, 4, 5, 6].every((d) => !scheduleDays[d]?.on) ? (
                    <div style={{ color: "var(--text-muted)"}}>선택된 요일이 없습니다.</div>
                  ) : null}
                </div>
              </div>

              <div style={{ color: "var(--text-muted)" }}>
                현재 적용중인 시간표 : {currentScheduleText}
              </div>

              {scheduleError ? <div style={{ color: "#dc2626"}}>{scheduleError}</div> : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={closeScheduleEdit}
                  style={{ ...boxButton, padding: "8px 12px" }}
                >
                  취소
                </button>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={saveScheduleChange}
                  style={{ ...boxButton, padding: "8px 12px", fontWeight: 600 }}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
