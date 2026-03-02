"use client";

import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { loadAuthSession } from "@/lib/auth/supabaseAuth";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { findStudentByToken, loadStudents, saveStudents } from "@/lib/storage/students";
import { loadTeachers, TEACHERS_EVENT } from "@/lib/storage/teachers";
import {
  loadAllConsultationsStore,
  loadConsultationsByStudent,
  saveAllConsultationsStore,
} from "@/lib/storage/consultations";
import { buildConsultationMap, pickPrimaryConsultTag, type ConsultTag } from "@/lib/ui/session/consultationMap";
import { findClassIndexByDatePreferFuture, findLastClassIndex } from "@/lib/ui/session/pauseHelpers";
import { formatGrade, formatPhone, formatSchedule } from "@/lib/ui/student/formatters";
import {
  loadSessions,
  rebuildTeacherGoogleCalendarForStudentIds,
  saveSessions,
  sessionsByStudent,
  syncStudentGoogleCalendarMirrorForStudentIds,
} from "@/lib/storage/sessions";
import {
  buildBadges,
  buildBaseDatesISO,
  computeEffectiveISO,
  getDdayMeta,
  getSessionVisibility,
  metaMapKey,
  readMetaMap,
  useMetaMap,
} from "@/lib/factories/sessionFactories";
import {
  buildDisplayRecords,
  computeBaseCount,
  normalizePaymentHistoryRanges,
  computeRefundRatio,
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
import AutoResizeTextarea from "@/lib/ui/common/AutoResizeTextarea";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import { getAchievementBadgeStyle } from "@/lib/ui/common/achievementBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";
import { buildSessionContextBadges, getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import { StudentPaymentPanel } from "./panels/StudentPaymentPanel";
import { StudentConsultPanel } from "./panels/StudentConsultPanel";
import { useStudentConsult } from "./hooks/useStudentConsult";
import {
  calculateSessionAchievementPercent,
  isSessionProgressEventKeyForToken,
} from "@/lib/factories/sessionProgressFactory";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import {
  canEditSessionMeta,
  canTriggerCalendarSync,
  canUseConsultFeatures,
  type SessionRole,
} from "@/lib/policies/sessionRolePolicy";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { SHARED_CONSULTATIONS_KEY } from "@/lib/storage/sharedStateKeys";
import { loadLatestCoreSnapshotBaseline } from "@/lib/storage/safeSnapshotMerge";
import { makeId } from "@/lib/utils/id";
import { kstDateMs, nowIso, todayYmdKST } from "@/lib/utils/date";

type Role = SessionRole;

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
  const [refreshTick, setRefreshTick] = useState(0);
  const [teachers, setTeachers] = useState(() => loadTeachers());

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
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarSyncMessage, setCalendarSyncMessage] = useState("");

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
      if (!isSessionProgressEventKeyForToken(key, token)) return;
      setProgressTick((x) => x + 1);
    };

    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, onStudents);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, onSessions);
    window.addEventListener(TEACHERS_EVENT, onTeachers);
    window.addEventListener("storage", onStorage);
    window.addEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);

    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, onStudents);
      window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, onSessions);
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
    window.addEventListener(TUTORWEB_EVENTS.consultationsUpdated, onConsult);
    return () => window.removeEventListener(TUTORWEB_EVENTS.consultationsUpdated, onConsult);
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

  const showParentPhone = canUseConsultFeatures(accessRole); // 학생은 숨김(정책 확정)
  const canEdit = canEditSessionMeta(accessRole); // 학생 편집 없음(정책 확정)

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

  function onClickCalendarResync() {
    if (!student) return;
    setCalendarSyncing(true);
    setCalendarSyncMessage("");
    const normalizeEmail = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
    const auth = loadAuthSession();
    const currentEmail = normalizeEmail(auth?.email);
    const ownerEmail = normalizeEmail(teacherEmail === "-" ? "" : teacherEmail);
    const studentEmail = normalizeEmail(student.googleEmail);
    const isStudentSelf = Boolean(currentEmail && studentEmail && currentEmail === studentEmail);
    const hasProviderToken = Boolean((auth?.providerAccessToken ?? "").trim());

    if (!hasProviderToken) {
      setCalendarSyncing(false);
      setCalendarSyncMessage("실패: 구글 캘린더 권한 토큰이 없습니다. 홈에서 로그아웃 후 다시 로그인해주세요.");
      return;
    }

    if (isStudentSelf) {
      syncStudentGoogleCalendarMirrorForStudentIds([student.id]);
      setCalendarSyncMessage("학생 본인 캘린더 동기화를 시작했어요. 1~3초 뒤 구글 캘린더에서 확인해주세요.");
    } else if (currentEmail && ownerEmail && currentEmail === ownerEmail) {
      rebuildTeacherGoogleCalendarForStudentIds([student.id]);
    }

    if (!ownerEmail && !isStudentSelf) {
      setCalendarSyncMessage("요청은 보냈지만 담당 선생님 이메일이 없어 생성할 수 없습니다. 선생님 이메일을 먼저 확인해주세요.");
    } else if (currentEmail && currentEmail !== ownerEmail && !isStudentSelf) {
      setCalendarSyncMessage(
        `요청은 저장됐지만 현재 로그인 계정(${currentEmail})은 담당 선생님(${ownerEmail})이 아니어서 실제 생성은 안 됩니다. 담당 선생님 계정으로 로그인 후 다시 눌러주세요.`
      );
    } else if (!isStudentSelf) {
      setCalendarSyncMessage("기존 일정을 정리하고 다시 만드는 중이에요. 1~3초 뒤 캘린더/Meet 상태가 갱신됩니다.");
    }

    window.setTimeout(() => {
      if (isStudentSelf) {
        setCalendarSyncMessage("학생 본인 캘린더 동기화 요청을 마쳤어요. 구글 캘린더 앱에서 '옥진수학' 캘린더를 확인해주세요.");
        setCalendarSyncing(false);
        return;
      }
      const rows = loadSessions().filter((s) => s.studentId === student.id);
      const synced = rows.filter((s) => s.googleCalendarStatus === "synced").length;
      const pendingCount = rows.filter((s) => s.googleCalendarStatus === "pending").length;
      const errored = rows.filter((s) => s.googleCalendarStatus === "error");
      const firstError = errored.find((s) => (s.googleCalendarError ?? "").trim())?.googleCalendarError ?? "";
      if (errored.length > 0) {
        setCalendarSyncMessage(
          `동기화 결과: 성공 ${synced}개, 대기 ${pendingCount}개, 오류 ${errored.length}개. ${firstError ? `오류: ${firstError}` : ""
          }`
        );
      } else {
        setCalendarSyncMessage(`동기화 결과: 성공 ${synced}개, 대기 ${pendingCount}개, 오류 0개.`);
      }
      setCalendarSyncing(false);
    }, 2200);
  }

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
  const progressPercent = useMemo(() => {
    void progressTick;
    return (index: number) => {
      return calculateSessionAchievementPercent({
        token,
        sessionIndex: index,
      });
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
      const isLastClass = Boolean(lastClassIndex ? s.index === lastClassIndex : false);
      const refundStatus =
        refundCompletedIndex && s.index === refundCompletedIndex
          ? "completed"
          : refundRequestedIndex && s.index === refundRequestedIndex
            ? "requested"
            : null;
      candidates.push({
        index: s.index,
        iso: effectiveISO,
        status: meta.status,
        badges: buildSessionContextBadges({
          baseBadges: buildBadges(meta),
          lastClass: isLastClass,
          refundStatus,
        }),
        percent: progressPercent(s.index),
        lastClass: isLastClass,
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
  const consultHooks = useStudentConsult({
    isAdmin,
    student,
    history,
    consultRecords,
    token,
    sessions,
    baseDatesISO,
    metaMap,
    displayRecords,
    applyHistory,
    persistConsultationState,
  });

  if (!mounted) return null;

  if (!token) {
    return (
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
        <h1 className="page-title">학생 페이지</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>token이 없습니다.</p>
      </main>
    );
  }

  if (!student) {
    return (
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
        <h1 className="page-title">학생 페이지</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
          학생을 찾지 못했습니다. <code>{token}</code>
        </p>
      </main>
    );
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

  function buildNextStudentsList(updatedStudent: Student, sourceStudents?: Student[]): Student[] {
    const currentStudents = sourceStudents ?? loadStudents();
    return currentStudents.some((row) => row.id === updatedStudent.id)
      ? currentStudents.map((row) => (row.id === updatedStudent.id ? updatedStudent : row))
      : [...currentStudents, updatedStudent];
  }

  function buildSyncedSessionsForStudent(
    updatedStudent: Student,
    sourceSessions?: Session[]
  ): { list: Session[]; changed: boolean } {
    const all = sourceSessions ?? loadSessions();
    const own = all.filter((session) => session.studentId === updatedStudent.id);
    if (own.length === 0) return { list: all, changed: false };

    const maxIndex = own.reduce((max, session) => Math.max(max, session.index), 0);
    const nextBaseDatesISO = buildBaseDatesISO(updatedStudent, Math.max(120, updatedStudent.planCount ?? 0, maxIndex));
    const localMetaMap = readMetaMap(token);

    let changed = false;
    const next = all.map((session) => {
      if (session.studentId !== updatedStudent.id) return session;

      const { effectiveISO } = computeEffectiveISO({
        token,
        index: session.index,
        baseDatesISO: nextBaseDatesISO,
        metaMap: localMetaMap,
      });
      if (!effectiveISO || effectiveISO === session.displayAt) return session;
      changed = true;
      return {
        ...session,
        displayAt: effectiveISO,
      };
    });

    return { list: next, changed };
  }

  async function persistScheduleState(updatedStudent: Student): Promise<boolean> {
    const baseline = await loadLatestCoreSnapshotBaseline();
    const nextStudents = buildNextStudentsList(updatedStudent, baseline.students);
    const { list: nextSessions, changed: sessionsChanged } = buildSyncedSessionsForStudent(
      updatedStudent,
      baseline.sessions
    );

    try {
      await pushSharedSnapshot({
        students: nextStudents,
        ...(sessionsChanged ? { sessions: nextSessions } : {}),
      });

      saveStudents(nextStudents, { skipSharedSnapshot: true });
      if (sessionsChanged) {
        saveSessions(nextSessions, { skipSharedSnapshot: true });
      }
      return true;
    } catch (err) {
      console.error("시간 변경 서버 저장 실패:", err);
      return false;
    }
  }

  async function persistConsultationState(nextConsultRecords: ConsultationRecord[], nextStudentOverride?: Student): Promise<boolean> {
    if (!student) return false;

    const nextStore = {
      ...loadAllConsultationsStore(),
      [student.id]: nextConsultRecords,
    };
    const baseline = nextStudentOverride ? await loadLatestCoreSnapshotBaseline() : null;
    const nextStudents = nextStudentOverride
      ? buildNextStudentsList(nextStudentOverride, baseline?.students)
      : null;

    try {
      await pushSharedSnapshot({
        ...(nextStudents ? { students: nextStudents } : {}),
        stateKv: {
          [SHARED_CONSULTATIONS_KEY]: JSON.stringify(nextStore),
        },
      });

      if (nextStudents) {
        saveStudents(nextStudents, { skipSharedSnapshot: true });
      }
      saveAllConsultationsStore(nextStore, { skipSharedSnapshot: true });
      setConsultRecords(nextConsultRecords);
      return true;
    } catch (err) {
      console.error("상담 서버 저장 실패:", err);
      return false;
    }
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

  async function saveScheduleChange() {
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

    const ok = await persistScheduleState({ ...student, scheduleChangeEvents: nextEvents });
    if (!ok) {
      setScheduleError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
      return;
    }
    closeScheduleEdit();
  }





  async function applyHistory(
    records: PaymentRecord[],
    basePatch?: Partial<Student>,
    skipSessions = false,
    options?: {
      consultationRecords?: ConsultationRecord[];
    }
  ): Promise<boolean> {
    if (!student) return false;

    const normalized = normalizePaymentHistoryRanges(records, baseCount);
    const nextTotal = baseCount + normalized.reduce((sum, r) => sum + r.addedCount, 0);
    const updatedStudent = {
      ...student,
      ...basePatch,
      planCount: nextTotal,
      paymentHistory: normalized,
    } as Student;

    const baseline = await loadLatestCoreSnapshotBaseline();
    const currentStudents = baseline.students.length > 0 ? baseline.students : loadStudents();
    const nextStudents = currentStudents.some((row) => row.id === updatedStudent.id)
      ? currentStudents.map((row) => (row.id === updatedStudent.id ? updatedStudent : row))
      : [...currentStudents, updatedStudent];

    let nextAllSessions = baseline.sessions.length > 0 ? baseline.sessions : loadSessions();
    let nextMetaMap = readMetaMap(token);
    const nextConsultStore = options?.consultationRecords
      ? {
        ...loadAllConsultationsStore(),
        [student.id]: options.consultationRecords,
      }
      : null;

    const applyMetaPatch = (index: number, patch: Partial<NonNullable<typeof nextMetaMap[number]>>) => {
      const prev = nextMetaMap[index] ?? {};
      const merged = { ...prev, ...patch };
      nextMetaMap = {
        ...nextMetaMap,
        [index]: {
          status:
            merged.status === "present" || merged.status === "absent" || merged.status === "planned"
              ? merged.status
              : undefined,
          carry:
            merged.carry === undefined || merged.carry === null
              ? 0
              : Math.max(0, Math.floor(Number(merged.carry) || 0)),
          overrideDate: typeof merged.overrideDate === "string" ? merged.overrideDate : "",
          overrideHour:
            merged.overrideHour === undefined || merged.overrideHour === null
              ? null
              : Math.max(0, Math.min(23, Math.floor(Number(merged.overrideHour) || 0))),
          overrideMinute:
            merged.overrideMinute === undefined || merged.overrideMinute === null
              ? null
              : Math.max(0, Math.min(59, Math.floor(Number(merged.overrideMinute) || 0))),
          overrideSource:
            merged.overrideSource === "manual" || merged.overrideSource === "extension"
              ? merged.overrideSource
              : "",
          reason: typeof merged.reason === "string" ? merged.reason : "",
          record: typeof merged.record === "string" ? merged.record : "",
        },
      };
    };

    if (!skipSessions) {
      const all = baseline.sessions.length > 0 ? baseline.sessions : loadSessions();
      const prevStudentSessions = all.filter((s) => s.studentId === updatedStudent.id);
      const prevMaxIndex = prevStudentSessions.reduce((m, s) => Math.max(m, s.index), 0);
      const kept = all.filter((s) => s.studentId !== updatedStudent.id || s.index <= nextTotal);
      const workingSessions = [...kept];

      const maxIndex = workingSessions
        .filter((s) => s.studentId === updatedStudent.id)
        .reduce((m, s) => Math.max(m, s.index), 0);

      if (nextTotal > maxIndex) {
        const existing = workingSessions
          .filter((s) => s.studentId === updatedStudent.id)
          .sort((a, b) => a.index - b.index);
        let lastISO = existing.length > 0 ? existing[existing.length - 1].displayAt : null;

        for (let idx = maxIndex + 1; idx <= nextTotal; idx++) {
          const rules = rulesForIndex(updatedStudent, idx);
          const ownerRecord = normalized.find((r) => idx >= r.startIndex && idx <= r.endIndex);

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
          workingSessions.push({
            id: makeId(),
            studentId: updatedStudent.id,
            index: idx,
            displayAt,
            state: "normal",
            createdAt: nowIso(),
          });
          lastISO = displayAt;
        }
      }

      const sessionsNow = workingSessions
        .filter((s) => s.studentId === updatedStudent.id)
        .sort((a, b) => a.index - b.index);
      const byIndex = new Map(sessionsNow.map((s) => [s.index, s] as const));
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
            applyMetaPatch(idx, {
              overrideDate: ymd,
              overrideHour: hm.hour,
              overrideMinute: hm.minute,
              overrideSource: "extension",
            });
          }
          const nextRules = rulesForIndex(updatedStudent, idx + 1);
          const next = nextIsoFromRules({ rules: nextRules, afterISO: iso });
          if (!next) break;
          iso = next;
        }
        cursorISO = iso;
      }

      for (let idx = nextTotal + 1; idx <= prevMaxIndex; idx++) {
        applyMetaPatch(idx, { overrideDate: "", overrideHour: null, overrideMinute: null, overrideSource: "" });
      }

      const syncedBaseDates = buildBaseDatesISO(updatedStudent, 60);
      nextAllSessions = workingSessions.map((s) => {
        if (s.studentId !== updatedStudent.id) return s;
        const { effectiveISO } = computeEffectiveISO({
          token,
          index: s.index,
          baseDatesISO: syncedBaseDates,
          metaMap: nextMetaMap,
        });
        if (!effectiveISO) return s;
        return { ...s, displayAt: effectiveISO };
      });
    }

    try {
      const nextStateKv: Record<string, string> = {};
      if (!skipSessions) {
        nextStateKv[metaMapKey(token)] = JSON.stringify(nextMetaMap);
      }
      if (nextConsultStore) {
        nextStateKv[SHARED_CONSULTATIONS_KEY] = JSON.stringify(nextConsultStore);
      }

      await pushSharedSnapshot({
        students: nextStudents,
        ...(skipSessions ? {} : { sessions: nextAllSessions }),
        ...(Object.keys(nextStateKv).length > 0 ? { stateKv: nextStateKv } : {}),
      });

      saveStudents(nextStudents, { skipSharedSnapshot: true });
      if (!skipSessions) {
        browserStorage.setItem(metaMapKey(token), JSON.stringify(nextMetaMap));
        window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
        saveSessions(nextAllSessions, { skipSharedSnapshot: true });
      }
      if (nextConsultStore && options?.consultationRecords) {
        saveAllConsultationsStore(nextConsultStore, { skipSharedSnapshot: true });
        setConsultRecords(options.consultationRecords);
      }

      setRefreshTick((x) => x + 1);
      return true;
    } catch (err) {
      console.error("결제/환불 서버 저장 실패:", err);
      alert("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
      return false;
    }
  }

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
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
              {canUseConsultFeatures(accessRole) ? (
                <Badge style={{ background: studentStatusView.bg, color: studentStatusView.color }}>
                  {studentStatusView.label}
                </Badge>
              ) : null}
            </div>
            {canUseConsultFeatures(accessRole) ? (
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
          <button className="btn btn-bold" onClick={() => consultHooks.actions.openConsultNew("general")}>
            일반 상담
          </button>
        ) : null}

        {canTriggerCalendarSync(accessRole) ? (
          <button
            className="btn btn-white"
            onClick={onClickCalendarResync}
            disabled={calendarSyncing}
            title="현재 학생의 회차 캘린더/Meet를 다시 동기화"
          >
            {calendarSyncing ? "회차 동기화 중..." : "회차 동기화"}
          </button>
        ) : null}

        <button onClick={() => router.push(sessionListHref)} className="btn btn-green">
          수업 목록
        </button>

        {isAdmin ? (
          <button onClick={() => consultHooks.actions.openConsultNew("extension")} className="btn btn-blue" title="연장 요청">
            연장 요청
          </button>
        ) : null}

        {canEdit ? (
          <button
            className="btn btn-orange"
            title="휴회 요청"
            onClick={() => consultHooks.actions.openConsultNew("pause_request")}
          >
            휴회 요청
          </button>
        ) : null}
      </section>

      {canTriggerCalendarSync(accessRole) && calendarSyncMessage ? (
        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13 }}>{calendarSyncMessage}</div>
      ) : null}

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
                      {(() => {
                        const statusBadge = getSessionStatusBadge(item.status as "present" | "absent" | "planned");
                        return <Badge style={statusBadge.style}>{statusBadge.label}</Badge>;
                      })()}
                      {item.badges.map((badge) => (
                        <Badge key={`${item.index}:${badge}`} style={getSessionExtraBadgeStyle(badge)}>
                          {badge}
                        </Badge>
                      ))}
                      {canUseConsultFeatures(accessRole) &&
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
                    {canUseConsultFeatures(accessRole) ? (
                      <ConsultButton tag={consultTag} onClick={() => consultHooks.actions.openConsultForSession(consultTag)} />
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
                      onClick={async () => {
                        const ok = confirm("이 시간 변경 기록을 삭제하시겠습니까?");
                        if (!ok) return;
                        const nextEvents = (student?.scheduleChangeEvents ?? []).filter((x) => x.id !== e.id);
                        const saved = await persistScheduleState({ ...student, scheduleChangeEvents: nextEvents });
                        if (!saved) {
                          alert("시간 변경 삭제를 서버에 저장하지 못했어요. 잠시 뒤 다시 시도해주세요.");
                        }
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

      <StudentConsultPanel
        consultHooks={consultHooks}
        consultRecords={consultRecords}
        accessRole={accessRole}
        canEdit={canEdit}
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
                    <div style={{ color: "var(--text-muted)" }}>선택된 요일이 없습니다.</div>
                  ) : null}
                </div>
              </div>

              <div style={{ color: "var(--text-muted)" }}>
                현재 적용중인 시간표 : {currentScheduleText}
              </div>

              {scheduleError ? <div style={{ color: "#dc2626" }}>{scheduleError}</div> : null}

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
