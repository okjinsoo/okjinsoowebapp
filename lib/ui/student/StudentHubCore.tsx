"use client";

import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { loadAuthSession } from "@/lib/auth/supabaseAuth";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { saveStudents, saveStudentsServerFirst } from "@/lib/storage/students";
import { formatGrade, formatPhone, formatSchedule } from "@/lib/ui/student/formatters";
import {
  rebuildTeacherGoogleCalendarForStudentIds,
  requestCalendarResyncForStudentIdsByAdmin,
  saveSessions,
  syncStudentGoogleCalendarMirrorForStudentIds,
} from "@/lib/storage/sessions";
import {
  buildBadges,
  buildBaseDatesISO,
  computeEffectiveISO,
  getDdayMeta,
  metaMapKey,
  readMetaMap,
  useMetaMap,
} from "@/lib/factories/sessionFactories";
import {
  buildDisplayRecords,
  computeBaseCount,
  normalizePaymentHistoryRanges,
} from "@/lib/factories/lessonStatusFactory";
import {
  computeStudentStatusFromMetrics,
  getStudentStatusMeta,
} from "@/lib/factories/studentStatusFactory";
import type {
  PaymentRecord,
  ScheduleRule,
  Session,
  Student,
  Teacher,
  Weekday,
} from "@/lib/types/index";
import { fmtKST_yyyyMMdd_TimeRange } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import SessionCardRow from "@/lib/ui/session/SessionCardRow";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import { buildSessionContextBadges } from "@/lib/ui/common/sessionExtraBadge";
import {
  buildSessionCardViewModel,
  resolveDurationMinForSessionWithMeta,
} from "@/lib/ui/session/sessionCardFactory";
import { StudentPaymentPanel } from "./panels/StudentPaymentPanel";
import {
  calculateSessionAchievementPercent,
  isSessionProgressEventKeyForToken,
} from "@/lib/factories/sessionProgressFactory";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import {
  canEditSessionMeta,
  canTriggerCalendarSync,
  type SessionRole,
} from "@/lib/policies/sessionRolePolicy";
import {
  isLocalOnlySnapshotMode,
  pullSharedSnapshotAndHydrateWithOptions,
  pushSharedSnapshot,
  readLocalSharedStateKv,
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";
import {
  SHARED_DRIVE_ROOT_ID_KEY,
  SHARED_LECTURE_TREE_KEY,
} from "@/lib/storage/sharedStateKeys";
import { ensureFolder, shareFolderWithEmail } from "@/lib/integrations/googleDriveSync";
import { loadLatestCoreSnapshotBaselineServerRequired } from "@/lib/storage/safeSnapshotMerge";
import { makeId } from "@/lib/utils/id";
import { kstDateMs, nowIso, todayYmdKST } from "@/lib/utils/date";
import {
  buildStudentSessionsFromRows,
  fetchServerJson,
  readSnapshotServerFirst,
} from "@/lib/storage/serverRead";
import { useStudentSessionContext } from "@/lib/hooks/useStudentSessionContext";
import { useTeachersServerFirst } from "@/lib/hooks/useTeachersServerFirst";
import {
  SERVER_LOAD_RETRY_MESSAGE,
  SERVER_SAVE_RETRY_MESSAGE,
} from "@/lib/messages/serverMessages";

type Role = SessionRole;
type SessionAddRuleDraft = {
  weekday: Weekday;
  hour: number;
  minute: 0 | 30;
  durationHour: 1 | 1.5 | 2;
};

function normalizeHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function normalizeSessionAddDurationHour(n: number): 1 | 1.5 | 2 {
  if (!Number.isFinite(n)) return 1;
  if (n <= 1.25) return 1;
  if (n <= 1.75) return 1.5;
  return 2;
}

function formatDurationHourLabel(durationHour: number): string {
  if (durationHour === 1.5) return "1시간 30분";
  return `${durationHour}시간`;
}

function normalizeWeeklyCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(7, Math.floor(n)));
}

function normalizeSessionAddCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

function formatTimeLabel(hour: number, minute: number = 0): string {
  const hh = String(normalizeHour(hour)).padStart(2, "0");
  const mm = Number(minute) >= 30 ? "30" : "00";
  return `${hh}시 ${mm}분`;
}

function weekdayFullLabel(n: number): string {
  const map: Record<number, string> = {
    0: "일요일",
    1: "월요일",
    2: "화요일",
    3: "수요일",
    4: "목요일",
    5: "금요일",
    6: "토요일",
  };
  return map[n] ?? `${n}요일`;
}

type StudentBackupFileV1 = {
  format: "tutorweb_student_backup";
  version: 1 | 2;
  exportedAt: string;
  exportedByRole: Role;
  source: "server" | "local";
  payload: {
    student: Student;
    teacher: Teacher | null;
    sessions: Session[];
    stateKv: Record<string, string>;
  };
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeStateKvStrings(raw: unknown): Record<string, string> {
  const obj = asObject(raw);
  if (!obj) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!key || typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

function sanitizeFilePart(raw: string): string {
  const compact = raw.trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9가-힣_-]/g, "");
  return compact || "student";
}

function sessionStatePrefix(token: string): string {
  return `mk3:${token}:session:`;
}

function collectStudentScopedStateKeys(stateKv: Record<string, string>, studentToken: string): string[] {
  if (!studentToken) return [];
  const prefix = sessionStatePrefix(studentToken);
  const metaKey = metaMapKey(studentToken);
  return Object.keys(stateKv).filter((key) => key === metaKey || key.startsWith(prefix));
}

function pickStudentBackupStateKv(stateKv: Record<string, string>, studentToken: string): Record<string, string> {
  if (!studentToken) return {};
  const prefix = sessionStatePrefix(studentToken);
  const metaKey = metaMapKey(studentToken);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(stateKv)) {
    if (key === SHARED_LECTURE_TREE_KEY || key === metaKey || key.startsWith(prefix)) {
      out[key] = value;
    }
  }
  return out;
}

function parseStudentBackupFile(raw: unknown): StudentBackupFileV1 | null {
  const root = asObject(raw);
  if (!root) return null;
  if (root.format !== "tutorweb_student_backup") return null;
  const version = Number(root.version);
  if (version !== 1 && version !== 2) return null;
  const payload = asObject(root.payload);
  if (!payload) return null;
  const student = asObject(payload.student);
  if (!student || typeof student.id !== "string" || typeof student.token !== "string") return null;
  const sessions = Array.isArray(payload.sessions) ? (payload.sessions as Session[]) : [];
  const teacherObj = payload.teacher === null ? null : asObject(payload.teacher);
  const teacher = teacherObj ? (teacherObj as Teacher) : null;
  const stateKv = normalizeStateKvStrings(payload.stateKv);
  return {
    format: "tutorweb_student_backup",
    version: version as 1 | 2,
    exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : "",
    exportedByRole: root.exportedByRole === "a" || root.exportedByRole === "t" || root.exportedByRole === "s"
      ? (root.exportedByRole as Role)
      : "a",
    source: root.source === "local" ? "local" : "server",
    payload: {
      student: student as Student,
      teacher,
      sessions,
      stateKv,
    },
  };
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
  backToTmainHref,
}: {
  role: Role;
  token: string;
  prefix: string; // "/a/students" | "/t/students" | "/s"
  hideTokenInRoute?: boolean;
  editPrefix?: string;
  backToTmainHref?: string | null;
}) {
  const router = useRouter();
  const accessRole: Role = role;
  const isAdmin = accessRole === "a";
  const [mounted, setMounted] = useState(false);
  const { teachers } = useTeachersServerFirst();
  const {
    student,
    sessions,
    isInitialLoaded,
    refresh: refreshStudentContext,
    setStudent,
    setSessions,
  } = useStudentSessionContext(token);

  const [scheduleEditOpen, setScheduleEditOpen] = useState(false);
  const [scheduleStartIndex, setScheduleStartIndex] = useState(1);
  const [scheduleStartDate, setScheduleStartDate] = useState("");
  const [scheduleEditWeeklyCount, setScheduleEditWeeklyCount] = useState(1);
  const [scheduleEditRules, setScheduleEditRules] = useState<SessionAddRuleDraft[]>([
    { weekday: 1, hour: 17, minute: 0, durationHour: 1 },
  ]);
  const [scheduleError, setScheduleError] = useState("");
  const [sessionAddOpen, setSessionAddOpen] = useState(false);
  const [sessionAddStartDate, setSessionAddStartDate] = useState(() => todayYmdKST());
  const [sessionAddCount, setSessionAddCount] = useState(4);
  const [sessionAddWeeklyCount, setSessionAddWeeklyCount] = useState(1);
  const [sessionAddRules, setSessionAddRules] = useState<SessionAddRuleDraft[]>([
    { weekday: 1, hour: 17, minute: 0, durationHour: 1 },
  ]);
  const [sessionAddError, setSessionAddError] = useState("");
  const [sessionAddSaving, setSessionAddSaving] = useState(false);
  const [progressTick, setProgressTick] = useState(0);
  const [calendarSyncing, setCalendarSyncing] = useState(false);
  const [calendarSyncMessage, setCalendarSyncMessage] = useState("");
  const [isLockerSyncing, setIsLockerSyncing] = useState(false);
  const [isBackupWorking, setIsBackupWorking] = useState(false);
  const [isRestoreWorking, setIsRestoreWorking] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const autoSessionRepairKeyRef = useRef("");
  const localOnlyMode = isLocalOnlySnapshotMode();

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onStorage: EventListener = (e) => {
      const se = e as StorageEvent;
      if (!se.key) return;
      if (
        se.key === "tutorweb_students_v1" ||
        se.key === "tutorweb_sessions_v1"
      ) {
        void refreshStudentContext();
      }
    };
    const onProgressChanged: EventListener = (event) => {
      const ce = event as CustomEvent<{ key?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (!key) return;
      if (!isSessionProgressEventKeyForToken(key, token)) return;
      setProgressTick((x) => x + 1);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);
    };
  }, [token, refreshStudentContext]);

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

  const teacherPhone = useMemo(() => {
    const tid = student?.teacherId ?? null;
    if (!tid) return "-";
    return teachers.find((t) => t.id === tid)?.phone ?? "-";
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

  const studentStatusView = useMemo(() => {
    if (!student) return { label: "-", bg: "#6b7280", color: "#fff" };

    const today = todayYmdKST();
    const pauseLifecycle = "none" as const;
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
      hasPendingPauseRequest: false,
      overdueDays,
      remainingCount,
      passedCount,
    });
    const meta = getStudentStatusMeta(kind);
    return { label: meta.label, bg: meta.bg, color: meta.color };
  }, [student, sessions, token, baseDatesISO, metaMap, currentCount]);

  const showParentPhone = accessRole !== "s";
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
      setCalendarSyncMessage("실패: 구글 캘린더 권한 토큰이 없습니다. 홈에서 구글 권한을 다시 연결해주세요.");
      return;
    }

    if (isStudentSelf) {
      syncStudentGoogleCalendarMirrorForStudentIds([student.id]);
      setCalendarSyncMessage("학생 본인 캘린더 동기화를 시작했어요. 1~3초 뒤 구글 캘린더에서 확인해주세요.");
      window.setTimeout(() => {
        setCalendarSyncMessage("학생 본인 캘린더 동기화 요청을 마쳤어요. 구글 캘린더 앱에서 '옥진수학' 캘린더를 확인해주세요.");
        setCalendarSyncing(false);
      }, 2200);
      return;
    }

    if (!ownerEmail) {
      setCalendarSyncMessage("요청은 보냈지만 담당 선생님 이메일이 없어 생성할 수 없습니다. 선생님 이메일을 먼저 확인해주세요.");
      setCalendarSyncing(false);
      return;
    }

    if (currentEmail && currentEmail === ownerEmail) {
      rebuildTeacherGoogleCalendarForStudentIds([student.id]);
      setCalendarSyncMessage("기존 일정을 정리하고 다시 만드는 중이에요. 1~3초 뒤 캘린더/Meet 상태가 갱신됩니다.");
      window.setTimeout(() => {
        void (async () => {
          try {
            const baseline = await loadLatestCoreSnapshotBaselineServerRequired();
            const rows = baseline.sessions.filter((s) => s.studentId === student.id);
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
          } catch {
            setCalendarSyncMessage("동기화 요청은 전송했지만 서버 결과 확인에 실패했어요. 잠시 뒤 새로고침 해주세요.");
          }
          setCalendarSyncing(false);
        })();
      }, 2200);
      return;
    }

    if (isAdmin && currentEmail) {
      requestCalendarResyncForStudentIdsByAdmin([student.id]);
      setCalendarSyncMessage(
        `관리자 요청을 저장했어요. 현재 로그인 계정(${currentEmail})은 담당 선생님(${ownerEmail})이 아니므로 지금은 직접 생성하지 않습니다. 담당 선생님 계정으로 로그인하면 자동으로 다시 생성됩니다.`
      );
      setCalendarSyncing(false);
      return;
    }

    setCalendarSyncMessage(
      `현재 로그인 계정(${currentEmail || "미확인"})은 담당 선생님(${ownerEmail})이 아니어서 직접 생성할 수 없습니다. 담당 선생님 계정으로 로그인 후 다시 눌러주세요.`
    );
    setCalendarSyncing(false);
  }
  
  async function onClickLockerResync() {
    if (!student) return;
    setIsLockerSyncing(true);
    try {
      // 1. 구글 권한 확인
      const auth = loadAuthSession();
      const providerToken = auth?.providerAccessToken;
      if (!providerToken) throw new Error("구글 계정 연결이 필요합니다. 홈에서 구글 권한을 다시 연결해 주세요.");

      // 2. 최신 설정(본진 ID 등) 불러오기
      await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
      const driveRootId = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
      
      if (!driveRootId) {
        throw new Error("먼저 관리자 페이지에서 [본진 드라이브 입지 선정]을 완료해 주세요.");
      }

      // 3. 학생 전용 사물함 폴더 생성/확인
      const folderName = `${student.cohort}_${student.name}`;
      const fid = await ensureFolder({ token: providerToken, name: folderName, parentId: driveRootId });

      // 4. 학생 이메일로 권한 부여
      if (student.googleEmail?.includes("@")) {
        await shareFolderWithEmail({
          token: providerToken,
          fileId: fid,
          email: student.googleEmail
        });
      }

      // 5. 서버에 폴더 ID 저장 및 동기화
      const baseline = await loadLatestCoreSnapshotBaselineServerRequired();
      const nextStudents = buildNextStudentsList(
        { ...student, driveFolderId: fid },
        baseline.students
      );
      await saveStudentsServerFirst(nextStudents);
      setStudent((prev) => (prev ? { ...prev, driveFolderId: fid } : prev));
      
      window.alert(`사물함 정비 완료! ✨\n\n- 폴더 이름: ${folderName}\n- 배정 ID: ${fid}\n\n이제 사진을 제출하면 이 폴더로 안전하게 배달됩니다.`);
    } catch (err) {
      console.error("사물함 개별 정비 실패:", err);
      window.alert("정비에 실패했습니다: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsLockerSyncing(false);
    }
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

  function resolveCurrentRules(sourceStudent: Student): ScheduleRule[] {
    const sortedChanges = [...(sourceStudent.scheduleChangeEvents ?? [])].sort((a, b) => a.startIndex - b.startIndex);
    const today = todayYmdKST();
    let rules = [...(sourceStudent.scheduleRules ?? [])];
    for (const ch of sortedChanges) {
      if (!Array.isArray(ch.newRules) || ch.newRules.length === 0) continue;
      if (ch.startDate && ch.startDate > today) continue;
      rules = [...ch.newRules];
    }
    return rules;
  }

  function buildSessionAddRulesByCount(targetCount: number, seedRules: ScheduleRule[]): SessionAddRuleDraft[] {
    const count = normalizeWeeklyCount(targetCount);
    const source = seedRules.length > 0 ? seedRules : [{ weekday: 1 as Weekday, hour: 17, minute: 0, durationMin: 60 }];
    const out: SessionAddRuleDraft[] = [];
    for (let i = 0; i < count; i++) {
      const picked = source[i] ?? source[i % source.length];
      const rawDurationMin =
        Number.isFinite(Number(picked?.durationMin)) && Number(picked.durationMin) > 0
          ? Number(picked.durationMin)
          : 60;
      const nextWeekday = Math.max(0, Math.min(6, Math.floor(Number(picked?.weekday) || 0))) as Weekday;
      out.push({
        weekday: nextWeekday,
        hour: normalizeHour(Number(picked?.hour)),
        minute: Number(picked?.minute) >= 30 ? 30 : 0,
        durationHour: normalizeSessionAddDurationHour(rawDurationMin / 60),
      });
    }
    return out;
  }

  function openSessionAddModal() {
    if (!student) return;
    const currentRules = resolveCurrentRules(student);
    const defaultCount = normalizeWeeklyCount(currentRules.length > 0 ? currentRules.length : 1);
    setSessionAddWeeklyCount(defaultCount);
    setSessionAddCount(Math.max(1, defaultCount * 4));
    setSessionAddRules(buildSessionAddRulesByCount(defaultCount, currentRules));
    setSessionAddStartDate(todayYmdKST());
    setSessionAddError("");
    setSessionAddSaving(false);
    setSessionAddOpen(true);
  }

  function closeSessionAddModal() {
    if (sessionAddSaving) return;
    setSessionAddOpen(false);
    setSessionAddError("");
  }

  function updateSessionAddWeeklyCount(nextRawCount: number) {
    const nextCount = normalizeWeeklyCount(nextRawCount);
    setSessionAddWeeklyCount(nextCount);
    setSessionAddRules((prev) => {
      const source = prev.length > 0 ? prev : [{ weekday: 1, hour: 17, minute: 0, durationHour: 1 }];
      const next: SessionAddRuleDraft[] = [];
      for (let i = 0; i < nextCount; i++) {
        const picked = prev[i] ?? source[i % source.length];
        const nextWeekday = Math.max(0, Math.min(6, Math.floor(Number(picked.weekday) || 0))) as Weekday;
        next.push({
          weekday: nextWeekday,
          hour: normalizeHour(Number(picked.hour)),
          minute: Number(picked.minute) >= 30 ? 30 : 0,
          durationHour: normalizeSessionAddDurationHour(Number(picked.durationHour)),
        });
      }
      return next;
    });
  }

  function updateSessionAddRule(index: number, patch: Partial<SessionAddRuleDraft>) {
    setSessionAddRules((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        return {
          weekday:
            patch.weekday === undefined
              ? rule.weekday
              : (Math.max(0, Math.min(6, Math.floor(Number(patch.weekday)))) as Weekday),
          hour: patch.hour === undefined ? rule.hour : normalizeHour(Number(patch.hour)),
          minute: patch.minute === undefined ? (rule.minute ?? 0) : (Number(patch.minute) >= 30 ? 30 : 0),
          durationHour:
            patch.durationHour === undefined
              ? rule.durationHour
              : normalizeSessionAddDurationHour(Number(patch.durationHour)),
        };
      })
    );
  }

  function updateScheduleEditWeeklyCount(nextRawCount: number) {
    const nextCount = normalizeWeeklyCount(nextRawCount);
    setScheduleEditWeeklyCount(nextCount);
    setScheduleEditRules((prev) => {
      const source = prev.length > 0 ? prev : [{ weekday: 1, hour: 17, minute: 0, durationHour: 1 }];
      const next: SessionAddRuleDraft[] = [];
      for (let i = 0; i < nextCount; i++) {
        const picked = prev[i] ?? source[i % source.length];
        const nextWeekday = Math.max(0, Math.min(6, Math.floor(Number(picked.weekday) || 0))) as Weekday;
        next.push({
          weekday: nextWeekday,
          hour: normalizeHour(Number(picked.hour)),
          minute: Number(picked.minute) >= 30 ? 30 : 0,
          durationHour: normalizeSessionAddDurationHour(Number(picked.durationHour)),
        });
      }
      return next;
    });
  }

  function updateScheduleEditRule(index: number, patch: Partial<SessionAddRuleDraft>) {
    setScheduleEditRules((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        return {
          weekday:
            patch.weekday === undefined
              ? rule.weekday
              : (Math.max(0, Math.min(6, Math.floor(Number(patch.weekday)))) as Weekday),
          hour: patch.hour === undefined ? rule.hour : normalizeHour(Number(patch.hour)),
          minute: patch.minute === undefined ? (rule.minute ?? 0) : (Number(patch.minute) >= 30 ? 30 : 0),
          durationHour:
            patch.durationHour === undefined
              ? rule.durationHour
              : normalizeSessionAddDurationHour(Number(patch.durationHour)),
        };
      })
    );
  }

  const backToTmain =
    backToTmainHref ?? (accessRole === "a" ? "/a/tmain" : accessRole === "t" ? "/t/tmain" : null);

  const history = useMemo(() => student?.paymentHistory ?? [], [student]);
  const formatYmdDot = (ymd?: string) => (ymd ? ymd.replace(/-/g, ".") : "-");
  const baseCount = useMemo(() => computeBaseCount(student, history), [student, history]);
  const normalizedHistory = useMemo(
    () => normalizePaymentHistoryRanges(history, baseCount),
    [history, baseCount]
  );
  const expectedTotalFromHistory = useMemo(
    () => Math.max(0, baseCount + normalizedHistory.reduce((sum, record) => sum + record.addedCount, 0)),
    [baseCount, normalizedHistory]
  );
  const displayRecords = useMemo(
    () => buildDisplayRecords(student, history, baseCount).displayRecords,
    [student, history, baseCount]
  );

  useEffect(() => {
    if (!student || !isInitialLoaded || sessionAddSaving) return;

    const currentPlanCount = Math.max(0, Math.floor(Number(student.planCount) || 0));
    const currentMaxSessionIndex = sessions.reduce((max, row) => Math.max(max, row.index), 0);
    const historyChanged = JSON.stringify(normalizedHistory) !== JSON.stringify(history);
    const planMismatch = currentPlanCount !== expectedTotalFromHistory;
    const sessionOverflow = currentMaxSessionIndex > expectedTotalFromHistory;

    if (!historyChanged && !planMismatch && !sessionOverflow) {
      autoSessionRepairKeyRef.current = "";
      return;
    }

    const repairKey = [
      student.id,
      currentPlanCount,
      expectedTotalFromHistory,
      currentMaxSessionIndex,
      history.length,
    ].join("|");
    if (autoSessionRepairKeyRef.current === repairKey) return;
    autoSessionRepairKeyRef.current = repairKey;

    void (async () => {
      const ok = await applyHistory(normalizedHistory);
      if (ok) {
        autoSessionRepairKeyRef.current = "";
      }
    })();
    // applyHistory는 함수 선언 특성상 렌더마다 identity가 바뀌므로 의존성에서 제외한다.
    // 이 효과는 데이터 서명(repairKey) 기준으로만 동작한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    student,
    sessions,
    history,
    normalizedHistory,
    expectedTotalFromHistory,
    isInitialLoaded,
    sessionAddSaving,
  ]);

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
    const candidates: {
      index: number;
      iso: string;
      durationMin: number;
      status?: string;
      badges: string[];
      percent: number | null;
      lastClass?: boolean;
    }[] = [];

    for (const s of sessions) {
      if (refundCompletedIndex && s.index > refundCompletedIndex) continue;
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
      const durationMin = resolveDurationMinForSessionWithMeta(effectiveISO, rulesForIndex(student, s.index), meta);
      const refundStatus =
        refundCompletedIndex && s.index === refundCompletedIndex
          ? "completed"
          : refundRequestedIndex && s.index === refundRequestedIndex
            ? "requested"
            : null;
      candidates.push({
        index: s.index,
        iso: effectiveISO,
        durationMin,
        status: meta.status,
        badges: buildSessionContextBadges({
          baseBadges: buildBadges(meta),
          lastClass: false,
          refundStatus,
        }),
        percent: progressPercent(s.index),
        lastClass: false,
      });
    }

    return candidates.sort((a, b) => new Date(a.iso).getTime() - new Date(b.iso).getTime()).slice(0, 3);
  }, [student, sessions, token, baseDatesISO, metaMap, progressPercent, refundCompletedIndex, refundRequestedIndex]);

  useEffect(() => {
    if (!mounted || !isInitialLoaded) return;
    if (!student && (accessRole === "a" || accessRole === "t")) {
      console.warn("학생 데이터를 찾을 수 없어 목록으로 이동합니다.");
      router.push(accessRole === "a" ? "/a/students" : "/t/tmain");
    }
  }, [mounted, isInitialLoaded, student, accessRole, router]);

  if (!mounted) return null;

  if (!token) {
    return (
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
        <h1 className="page-title">학생 페이지</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>token이 없습니다.</p>
      </main>
    );
  }

  if (!isInitialLoaded) {
    return (
      <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
        <h1 className="page-title">학생 페이지</h1>
        <p style={{ marginTop: 8, color: "var(--text-muted)" }}>학생 정보를 불러오는 중입니다...</p>
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

    const rules = resolveCurrentRules(student);
    const defaultCount = normalizeWeeklyCount(rules.length > 0 ? rules.length : 1);
    setScheduleEditWeeklyCount(defaultCount);
    setScheduleEditRules(buildSessionAddRulesByCount(defaultCount, rules));
    setScheduleEditOpen(true);
  }

  function closeScheduleEdit() {
    setScheduleEditOpen(false);
    setScheduleError("");
  }

  function buildNextStudentsList(updatedStudent: Student, sourceStudents: Student[]): Student[] {
    const currentStudents = sourceStudents;
    return currentStudents.some((row) => row.id === updatedStudent.id)
      ? currentStudents.map((row) => (row.id === updatedStudent.id ? updatedStudent : row))
      : [...currentStudents, updatedStudent];
  }

  function buildSyncedSessionsForStudent(
    updatedStudent: Student,
    sourceSessions: Session[],
    options?: { force?: boolean }
  ): { list: Session[]; changed: boolean } {
    const all = sourceSessions;
    const own = all.filter((session) => String(session.studentId) === String(updatedStudent.id));
    if (own.length === 0) {
      console.warn("[Debug] No sessions found for student:", updatedStudent.id);
      return { list: all, changed: false };
    }

    const maxIndex = own.reduce((max, session) => Math.max(max, session.index), 0);
    const nextBaseDatesISO = buildBaseDatesISO(updatedStudent, Math.max(120, updatedStudent.planCount ?? 0, maxIndex));
    console.log("[Debug] Calculated baseDatesISO for student:", updatedStudent.name, "Count:", nextBaseDatesISO.length);
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
      if (!effectiveISO) return session;
      const isDifferent = effectiveISO !== session.displayAt;
      if (!options?.force && !isDifferent) return session;

      changed = true;
      return {
        ...session,
        displayAt: effectiveISO,
      };
    });

    return { list: next, changed };
  }

  async function persistScheduleState(
    updatedStudent: Student,
    clearExtensionFromIndex?: number
  ): Promise<boolean> {
    let baseline: Awaited<ReturnType<typeof loadLatestCoreSnapshotBaselineServerRequired>>;
    try {
      baseline = await loadLatestCoreSnapshotBaselineServerRequired();
    } catch (err) {
      console.error("시간 변경 서버 기준 데이터 로드 실패:", err);
      return false;
    }
    const nextStudents = buildNextStudentsList(updatedStudent, baseline.students);

    // ✅ 시간 변경 시작 회차 이후의 extension override(연장 결제 자동 설정 날짜)를 초기화
    // → computeEffectiveISO가 override 대신 새 baseDatesISO(수/토)를 사용하도록 해제
    // → manual override(선생님이 직접 변경한 날짜)는 건드리지 않음
    let metaChanged = false;
    const localMetaMap = readMetaMap(token);
    const nextMetaMap: Record<number, ReturnType<typeof readMetaMap>[number]> = { ...localMetaMap };
    if (clearExtensionFromIndex !== undefined && clearExtensionFromIndex >= 1) {
      for (const key of Object.keys(nextMetaMap)) {
        const idx = Number(key);
        if (!Number.isFinite(idx) || idx < clearExtensionFromIndex) continue;
        const meta = nextMetaMap[idx];
        if (meta?.overrideSource === "extension" && meta?.overrideDate) {
          nextMetaMap[idx] = {
            ...meta,
            overrideDate: "",
            overrideHour: null,
            overrideMinute: null,
            overrideDurationMin: null,
            overrideSource: "",
          };
          metaChanged = true;
        }
      }
      if (metaChanged) {
        browserStorage.setItem(metaMapKey(token), JSON.stringify(nextMetaMap));
        window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
      }
    }

    // metaMap이 초기화된 뒤 세션 날짜를 재계산
    const { list: nextSessions, changed: sessionsChanged } = buildSyncedSessionsForStudent(
      updatedStudent,
      baseline.sessions,
      { force: clearExtensionFromIndex !== undefined }
    );

    try {
      await pushSharedSnapshot({
        students: nextStudents,
        ...(sessionsChanged ? { sessions: nextSessions } : {}),
        ...(metaChanged
          ? { stateKv: { [metaMapKey(token)]: JSON.stringify(nextMetaMap) } }
          : {}),
      });

      saveStudents(nextStudents, { skipSharedSnapshot: true });
      if (sessionsChanged) {
        saveSessions(nextSessions, { skipSharedSnapshot: true });
        setSessions(
          buildStudentSessionsFromRows({
            student: updatedStudent,
            allSessions: nextSessions,
          })
        );
      }
      setStudent(updatedStudent);
      void refreshStudentContext();
      return true;
    } catch (err) {
      console.error("시간 변경 서버 저장 실패:", err);
      return false;
    }
  }

  async function saveScheduleChange() {
    if (!student) return;
    setScheduleError("");
    const startIndex = Math.max(1, Math.floor(Number(scheduleStartIndex)));
    if (!Number.isFinite(startIndex)) return setScheduleError("시작 회차를 입력해주세요.");
    // startDate가 없으면 오늘 날짜를 기본값으로 사용
    const startDate = scheduleStartDate || todayYmdKST();

    const weeklyCount = normalizeWeeklyCount(scheduleEditWeeklyCount);
    const drafts = scheduleEditRules.slice(0, weeklyCount);
    const rules: ScheduleRule[] = drafts.map((rule) => ({
      weekday: rule.weekday,
      hour: normalizeHour(rule.hour),
      minute: Number(rule.minute) >= 30 ? 30 : 0,
      durationMin: Math.round(normalizeSessionAddDurationHour(rule.durationHour) * 60),
    }));
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
    const normalizedStartDate = (startDate || fallbackStartDate || "").trim();

    nextEvents.push({
      id: makeId(),
      startIndex,
      startDate: normalizedStartDate || undefined,
      newRules: rules,
      createdAt: nowIso(),
    });
    nextEvents.sort((a, b) => a.startIndex - b.startIndex);

    const ok = await persistScheduleState({ ...student, scheduleChangeEvents: nextEvents }, startIndex);
    if (!ok) {
      setScheduleError(SERVER_SAVE_RETRY_MESSAGE);
      return;
    }
    closeScheduleEdit();
  }

  async function saveSessionAdd() {
    if (!student || sessionAddSaving) return;
    setSessionAddError("");

    const startDate = (sessionAddStartDate ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setSessionAddError("시작일을 정확히 입력해주세요.");
      return;
    }
    const startDateMs = new Date(`${startDate}T00:00:00+09:00`).getTime();
    if (!Number.isFinite(startDateMs)) {
      setSessionAddError("시작일 형식이 올바르지 않습니다.");
      return;
    }

    const weeklyCount = normalizeWeeklyCount(sessionAddWeeklyCount);
    const drafts = sessionAddRules.slice(0, weeklyCount);
    if (drafts.length < 1) {
      setSessionAddError("주당 횟수를 먼저 설정해주세요.");
      return;
    }

    const rules: ScheduleRule[] = drafts.map((rule) => ({
      weekday: rule.weekday,
      hour: normalizeHour(rule.hour),
      minute: 0,
      durationMin: Math.round(normalizeSessionAddDurationHour(rule.durationHour) * 60),
    }));
    const addedCount = normalizeSessionAddCount(sessionAddCount);
    if (addedCount <= 0) {
      setSessionAddError("생성할 회차 수를 계산하지 못했습니다.");
      return;
    }

    const baseDates = buildBaseDatesISO(student, Math.max(120, currentCount + addedCount + 8));
    const localMetaMap = readMetaMap(token);
    // 회차 추가 시작점 검증은 "기록 기준 최종 회차"를 단일 기준으로 사용한다.
    const maxExistingIndex = Math.max(0, expectedTotalFromHistory);
    if (maxExistingIndex > 0) {
      const { effectiveISO } = computeEffectiveISO({
        token,
        index: maxExistingIndex,
        baseDatesISO: baseDates,
        metaMap: localMetaMap,
      });
      const lastYmd = ymdFromISO_KST(effectiveISO ?? "");
      if (lastYmd && startDate < lastYmd) {
        setSessionAddError(`시작일은 마지막 수업일(${formatYmdDot(lastYmd)}) 이후로 입력해주세요.`);
        return;
      }
    }

    const paymentRecord: PaymentRecord = {
      id: makeId(),
      paymentDate: startDate,
      addedCount,
      startIndex: 0,
      endIndex: 0,
      sessionAddStartDate: startDate,
      sessionAddWeeklyCount: rules.length,
      sessionAddRules: rules.map((rule) => ({
        weekday: rule.weekday,
        hour: rule.hour,
        durationHour: normalizeSessionAddDurationHour((rule.durationMin ?? 60) / 60),
      })),
      memo: `회차 추가(${addedCount}회, 주 ${rules.length}회 패턴)`,
      createdAt: nowIso(),
    };
    const nextHistory = [...history, paymentRecord];
    const normalizedPreview = normalizePaymentHistoryRanges(nextHistory, baseCount);
    const appended = normalizedPreview.at(-1);
    const startIndex = Math.max(1, Math.floor(Number(appended?.startIndex) || 0));
    if (!Number.isFinite(startIndex) || startIndex < 1) {
      setSessionAddError("새 회차 시작 번호를 계산하지 못했습니다.");
      return;
    }

    const existingEvent = (student.scheduleChangeEvents ?? []).find((e) => e.startIndex === startIndex);
    if (existingEvent) {
      const ok = confirm(`${startIndex}회차부터 적용되는 시간표가 이미 있어요. 새 값으로 바꿀까요?`);
      if (!ok) return;
    }

    const nextEvents = (student.scheduleChangeEvents ?? []).filter((e) => e.startIndex !== startIndex);
    nextEvents.push({
      id: makeId(),
      startIndex,
      startDate,
      newRules: rules,
      createdAt: nowIso(),
    });
    nextEvents.sort((a, b) => a.startIndex - b.startIndex);

    setSessionAddSaving(true);
    const ok = await applyHistory(nextHistory, { scheduleChangeEvents: nextEvents }, false);
    setSessionAddSaving(false);
    if (!ok) {
      setSessionAddError(SERVER_SAVE_RETRY_MESSAGE);
      return;
    }
    closeSessionAddModal();
  }





  async function applyHistory(
    records: PaymentRecord[],
    basePatch?: Partial<Student>,
    skipSessions = false,
    options?: {
      baseCountOverride?: number;
    }
  ): Promise<boolean> {
    if (!student) return false;

    let serverSnapshot: Awaited<ReturnType<typeof readSnapshotServerFirst>>;
    try {
      serverSnapshot = await readSnapshotServerFirst();
      if (!isLocalOnlySnapshotMode() && serverSnapshot.source !== "server") {
        throw new Error("server_snapshot_unavailable");
      }
    } catch (err) {
      console.error("결제/환불 저장용 서버 기준 데이터 로드 실패:", err);
      alert(SERVER_LOAD_RETRY_MESSAGE);
      return false;
    }

    const normalizedBaseCount = Math.max(
      0,
      Math.floor(
        Number.isFinite(Number(options?.baseCountOverride))
          ? Number(options?.baseCountOverride)
          : baseCount
      )
    );
    const normalized = normalizePaymentHistoryRanges(records, normalizedBaseCount);
    const calculatedTotal = normalizedBaseCount + normalized.reduce((sum, r) => sum + r.addedCount, 0);
    const currentMaxIndex = serverSnapshot.sessions
      .filter((s) => s.studentId === student.id)
      .reduce((m, s) => Math.max(m, s.index), 0);
    // 결제 기록 삭제/축소 시 실제 회차도 함께 줄어들어야 하므로
    // "현재 최대 회차 유지"가 아니라 "결제기록 계산값"을 기준으로 맞춘다.
    const nextTotal = Math.max(0, calculatedTotal);
    const updatedStudent = {
      ...student,
      ...basePatch,
      planCount: nextTotal,
      paymentHistory: normalized,
    } as Student;

    const nextStudents = buildNextStudentsList(updatedStudent, serverSnapshot.students);

    let nextAllSessions = serverSnapshot.sessions;
    let nextMetaMap = readMetaMap(token);

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
          overrideDurationMin:
            merged.overrideDurationMin === undefined || merged.overrideDurationMin === null
              ? null
              : Math.max(1, Math.floor(Number(merged.overrideDurationMin) || 0)),
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
      const all = serverSnapshot.sessions;
      const prevMaxIndex = currentMaxIndex;
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

      // [DELETED] 연장 결제 시 미래 회차 날짜를 강제로 고정하는 로직을 삭제했습니다.
      // 이제 결제된 회차들은 metaMap에 박제되지 않고, 현재 시간표 규칙(Law)을 동적으로 따릅니다.
      // -----------------------------------------------------------------

      for (let idx = nextTotal + 1; idx <= prevMaxIndex; idx++) {
        applyMetaPatch(idx, {
          overrideDate: "",
          overrideHour: null,
          overrideMinute: null,
          overrideDurationMin: null,
          overrideSource: "",
        });
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

      setStudent(updatedStudent);
      if (!skipSessions) {
        setSessions(
          buildStudentSessionsFromRows({
            student: updatedStudent,
            allSessions: nextAllSessions,
          })
        );
      }
      void refreshStudentContext();
      return true;
    } catch (err) {
      console.error("결제/환불 서버 저장 실패:", err);
      alert(SERVER_SAVE_RETRY_MESSAGE);
      return false;
    }
  }

  async function handleDownloadStudentBackup() {
    if (!student || isBackupWorking) return;
    setIsBackupWorking(true);
    try {
      const snapshot = await readSnapshotServerFirst();
      if (!localOnlyMode && snapshot.source !== "server") {
        throw new Error("server_snapshot_unavailable");
      }

      const sourceStudent =
        snapshot.students.find((row) => row.id === student.id || row.token === student.token) ?? student;
      const sourceTeacher = snapshot.teachers.find((row) => row.id === sourceStudent.teacherId) ?? null;
      const sourceSessions = snapshot.sessions
        .filter((row) => row.studentId === sourceStudent.id)
        .sort((a, b) => a.index - b.index);

      let stateKvAll: Record<string, string> = {};
      if (snapshot.source === "server") {
        const stateSnapshot = await fetchServerJson<{
          stateKv?: Record<string, string> | null;
        }>("/api/snapshot", "snapshot");
        if (!stateSnapshot.ok || !stateSnapshot.data) {
          throw new Error("snapshot_state_kv_unavailable");
        }
        stateKvAll = normalizeStateKvStrings(stateSnapshot.data.stateKv);
      } else {
        stateKvAll = readLocalSharedStateKv();
      }

      const backupStateKv = pickStudentBackupStateKv(stateKvAll, sourceStudent.token ?? token);
      const backup: StudentBackupFileV1 = {
        format: "tutorweb_student_backup",
        version: 2,
        exportedAt: nowIso(),
        exportedByRole: accessRole,
        source: snapshot.source,
        payload: {
          student: sourceStudent,
          teacher: sourceTeacher,
          sessions: sourceSessions,
          stateKv: backupStateKv,
        },
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const namePart = sanitizeFilePart(sourceStudent.name ?? "student");
      const tokenPart = sanitizeFilePart(sourceStudent.token ?? token);
      const stamp = todayYmdKST().replace(/-/g, "");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `tutorweb-student-backup-${namePart}-${tokenPart}-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("학생 데이터 백업 실패:", err);
      alert("데이터 백업에 실패했습니다. 잠시 뒤 다시 시도해주세요.");
    } finally {
      setIsBackupWorking(false);
    }
  }

  function openRestoreFilePicker() {
    if (!localOnlyMode) {
      alert("데이터 복원은 로컬 테스트 서버에서만 사용할 수 있습니다.");
      return;
    }
    if (isRestoreWorking) return;
    restoreInputRef.current?.click();
  }

  async function handleRestoreBackupFile(file: File) {
    if (!localOnlyMode) {
      alert("데이터 복원은 로컬 테스트 서버에서만 사용할 수 있습니다.");
      return;
    }
    if (isRestoreWorking) return;
    setIsRestoreWorking(true);
    try {
      const raw = await file.text();
      const parsed = parseStudentBackupFile(JSON.parse(raw));
      if (!parsed) {
        throw new Error("invalid_backup_format");
      }

      const importedStudent = parsed.payload.student;
      const importedTeacher = parsed.payload.teacher;
      const importedToken = importedStudent.token ?? "";
      if (!importedToken) {
        throw new Error("invalid_student_token");
      }

      const confirmMessage =
        `${importedStudent.name ?? "-"} 학생 데이터를 로컬에 복원합니다.\n` +
        "기존 같은 학생(token) 데이터는 교체됩니다.\n" +
        "계속 진행할까요?";
      if (!window.confirm(confirmMessage)) {
        return;
      }

      const baseline = await readSnapshotServerFirst();
      const localStateKv = readLocalSharedStateKv();

      const existingSameToken = baseline.students.find((row) => row.token === importedToken);
      const removeStudentIds = new Set<string>([importedStudent.id]);
      if (existingSameToken) {
        removeStudentIds.add(existingSameToken.id);
      }

      const nextStudents = baseline.students
        .filter((row) => !removeStudentIds.has(row.id) && row.token !== importedToken)
        .concat(importedStudent);
      const nextSessions = baseline.sessions
        .filter((row) => !removeStudentIds.has(row.studentId))
        .concat(parsed.payload.sessions.filter((row) => row.studentId === importedStudent.id));

      const nextTeachers = importedTeacher
        ? baseline.teachers.filter((row) => row.id !== importedTeacher.id).concat(importedTeacher)
        : baseline.teachers;

      const dropStateKeys = collectStudentScopedStateKeys(localStateKv, importedToken);
      const nextStateKvPatch: Record<string, string> = {
        ...parsed.payload.stateKv,
      };

      await pushSharedSnapshot({
        teachers: nextTeachers,
        students: nextStudents,
        sessions: nextSessions,
        stateKv: nextStateKvPatch,
        dropStateKeys,
      });

      alert("로컬 복원이 완료되었습니다.");
      void refreshStudentContext();
    } catch (err) {
      console.error("학생 데이터 복원 실패:", err);
      alert("데이터 복원에 실패했습니다. 파일 형식을 확인해주세요.");
    } finally {
      setIsRestoreWorking(false);
    }
  }

  function onRestoreFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void handleRestoreBackupFile(file);
  }

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {backToTmain ? (
          <div
            style={{
              width: "100%",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button onClick={() => router.push(backToTmain)} className="btn btn-bold">
              학생 관리
            </button>
            {canEdit ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={handleDownloadStudentBackup}
                  className="btn"
                  disabled={isBackupWorking || isRestoreWorking}
                  title="현재 학생의 전체 데이터를 JSON 파일로 저장"
                >
                  {isBackupWorking ? "백업 중..." : "데이터 백업"}
                </button>
                {localOnlyMode ? (
                  <>
                    <button
                      onClick={openRestoreFilePicker}
                      className="btn"
                      disabled={isRestoreWorking || isBackupWorking}
                      title="로컬 테스트 서버 전용: 백업 JSON 파일 복원"
                    >
                      {isRestoreWorking ? "복원 중..." : "데이터 복원"}
                    </button>
                    <input
                      ref={restoreInputRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={onRestoreFileInputChange}
                      style={{ display: "none" }}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
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

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr 140px 1fr",
              gap: 10,
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 900 }}>선생님 이메일</div>
            <div style={{ wordBreak: "break-all" }}>{teacherEmail}</div>
            <div style={{ fontWeight: 900 }}>선생님 전화번호</div>
            <div>{teacherPhone !== "-" ? formatPhone(teacherPhone) : "-"}</div>
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

        {canTriggerCalendarSync(accessRole) ? (
          <div style={{ display: "flex", gap: 8 }}>
            {(accessRole === "a" || accessRole === "t") && (
              <button
                className="btn"
                onClick={onClickLockerResync}
                disabled={isLockerSyncing}
                style={{ 
                  background: "#fdf2f2", 
                  border: "1px solid #fecaca", 
                  color: "#dc2626",
                  fontWeight: 700
                }}
              >
                {isLockerSyncing ? "정리 중..." : "사물함 정리"}
              </button>
            )}
            <button
              className="btn"
              onClick={onClickCalendarResync}
              disabled={calendarSyncing}
              style={{ 
                background: "#fdf2f2", 
                border: "1px solid #fecaca", 
                color: "#dc2626",
                fontWeight: 700
              }}
              title="현재 학생의 회차 캘린더/Meet를 다시 동기화"
            >
              {calendarSyncing ? "동기화 중..." : "회차 동기화"}
            </button>
          </div>
        ) : null}

        <button onClick={() => router.push(sessionListHref)} className="btn btn-green">
          수업 목록
        </button>

        {isAdmin ? (
          <button onClick={openSessionAddModal} className="btn btn-blue" title="회차 추가">
            회차 추가
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
              const dday = getDdayMeta(item.iso, new Date());
              const model = buildSessionCardViewModel({
                index: item.index,
                dateTimeText: fmtKST_yyyyMMdd_TimeRange(item.iso, item.durationMin),
                dday: dday && dday.diff !== null ? dday : null,
                status: (item.status as "present" | "absent" | "planned" | undefined) ?? "planned",
                achievementPercent: item.percent,
                extraBadges: item.badges,
              });
              return (
                <SessionCardRow
                  key={`${item.index}-${item.iso}`}
                  model={model}
                  onClick={() => router.push(`${sessionListHref}/${item.index}`)}
                  rightSlot={<SessionQuickActions role={accessRole} token={token} index={item.index} />}
                />
              );
            })}
          </div>
        )}
      </section>

      {isAdmin || accessRole === "t" ? (
        <StudentPaymentPanel
          isAdmin={isAdmin}
          history={history}
          applyHistory={applyHistory}
          student={student}
          baseCount={baseCount}
        />
      ) : null}

      {sessionAddOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 80,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 900 }}>회차 추가</div>
            <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
              시작일 기준으로 시간표 패턴을 적용해 입력한 회차 수만큼 생성합니다.
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>시작일</div>
                <input
                  type="date"
                  value={sessionAddStartDate}
                  onChange={(e) => setSessionAddStartDate(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>회차수</div>
                <input
                  type="number"
                  min={1}
                  value={sessionAddCount}
                  onChange={(e) => setSessionAddCount(normalizeSessionAddCount(Number(e.target.value)))}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>주당 횟수</div>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={sessionAddWeeklyCount}
                  onChange={(e) => updateSessionAddWeeklyCount(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridAutoFlow: "column",
                  gridAutoColumns: "minmax(240px, 1fr)",
                  gap: 8,
                  overflowX: "auto",
                  paddingBottom: 2,
                }}
              >
                {sessionAddRules.slice(0, normalizeWeeklyCount(sessionAddWeeklyCount)).map((rule, i) => (
                  <div
                    key={`session-add-rule-${i}`}
                    style={{
                      border: "1px solid var(--surface-border)",
                      borderRadius: 8,
                      background: "var(--surface-bg)",
                      padding: 10,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{i + 1}번째 수업 박스</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>요일</span>
                      <select
                        value={rule.weekday}
                        onChange={(e) => updateSessionAddRule(i, { weekday: Number(e.target.value) as Weekday })}
                        style={{ ...selectStyle, width: "100%" }}
                      >
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                          <option key={`weekday-${d}`} value={d}>
                            {weekdayFullLabel(d)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>시작 시간</span>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <select
                          value={rule.hour}
                          onChange={(e) => updateSessionAddRule(i, { hour: Number(e.target.value) })}
                          style={{ ...selectStyle, width: "100%" }}
                          aria-label={`${i + 1}번째 수업 시작 시`}
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={`hour-${h}`} value={h}>
                              {String(h).padStart(2, "0")}시
                            </option>
                          ))}
                        </select>
                        <select
                          value={rule.minute ?? 0}
                          onChange={(e) => updateSessionAddRule(i, { minute: Number(e.target.value) as 0 | 30 })}
                          style={{ ...selectStyle, width: "100%" }}
                          aria-label={`${i + 1}번째 수업 시작 분`}
                        >
                          <option value={0}>00분</option>
                          <option value={30}>30분</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>수업시간</span>
                      <select
                        value={rule.durationHour}
                        onChange={(e) => updateSessionAddRule(i, { durationHour: Number(e.target.value) as 1 | 1.5 | 2 })}
                        style={{ ...selectStyle, width: "100%" }}
                        aria-label={`${i + 1}번째 수업 시간`}
                      >
                        {([1, 1.5, 2] as const).map((duration) => (
                          <option key={`duration-${duration}`} value={duration}>
                            {formatDurationHourLabel(duration)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ color: "var(--text-muted)" }}>
                      {weekdayFullLabel(rule.weekday)} · {formatTimeLabel(rule.hour, rule.minute ?? 0)} 시작 ·{" "}
                      {formatDurationHourLabel(normalizeSessionAddDurationHour(rule.durationHour))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ color: "var(--text-muted)" }}>총 {normalizeSessionAddCount(sessionAddCount)}회차가 추가됩니다.</div>

              {sessionAddError ? <div style={{ color: "#dc2626" }}>{sessionAddError}</div> : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={closeSessionAddModal}
                  style={{ ...boxButton, padding: "8px 12px" }}
                  disabled={sessionAddSaving}
                >
                  취소
                </button>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={saveSessionAdd}
                  style={{ ...boxButton, padding: "8px 12px", fontWeight: 600 }}
                  disabled={sessionAddSaving}
                >
                  {sessionAddSaving ? "적용 중..." : "적용"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
              maxWidth: 560,
              maxHeight: "90vh",
              overflowY: "auto",
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

              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>주당 횟수</div>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={scheduleEditWeeklyCount}
                  onChange={(e) => updateScheduleEditWeeklyCount(Number(e.target.value))}
                  style={inputStyle}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridAutoFlow: "column",
                  gridAutoColumns: "minmax(240px, 1fr)",
                  gap: 8,
                  overflowX: "auto",
                  paddingBottom: 2,
                }}
              >
                {scheduleEditRules.slice(0, normalizeWeeklyCount(scheduleEditWeeklyCount)).map((rule, i) => (
                  <div
                    key={`schedule-edit-rule-${i}`}
                    style={{
                      border: "1px solid var(--surface-border)",
                      borderRadius: 8,
                      background: "var(--surface-bg)",
                      padding: 10,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{i + 1}번째 수업 박스</div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>요일</span>
                      <select
                        value={rule.weekday}
                        onChange={(e) => updateScheduleEditRule(i, { weekday: Number(e.target.value) as Weekday })}
                        style={{ ...selectStyle, width: "100%" }}
                      >
                        {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                          <option key={`schedule-edit-weekday-${d}`} value={d}>
                            {weekdayFullLabel(d)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>시작 시간</span>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        <select
                          value={rule.hour}
                          onChange={(e) => updateScheduleEditRule(i, { hour: Number(e.target.value) })}
                          style={{ ...selectStyle, width: "100%" }}
                          aria-label={`${i + 1}번째 변경 시작 시`}
                        >
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={`schedule-edit-hour-${h}`} value={h}>
                              {String(h).padStart(2, "0")}시
                            </option>
                          ))}
                        </select>
                        <select
                          value={rule.minute ?? 0}
                          onChange={(e) => updateScheduleEditRule(i, { minute: Number(e.target.value) as 0 | 30 })}
                          style={{ ...selectStyle, width: "100%" }}
                          aria-label={`${i + 1}번째 변경 시작 분`}
                        >
                          <option value={0}>00분</option>
                          <option value={30}>30분</option>
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 6 }}>
                      <span style={{ fontWeight: 700 }}>수업시간</span>
                      <select
                        value={rule.durationHour}
                        onChange={(e) =>
                          updateScheduleEditRule(i, { durationHour: Number(e.target.value) as 1 | 1.5 | 2 })
                        }
                        style={{ ...selectStyle, width: "100%" }}
                        aria-label={`${i + 1}번째 변경 수업 시간`}
                      >
                        {([1, 1.5, 2] as const).map((duration) => (
                          <option key={`schedule-edit-duration-${duration}`} value={duration}>
                            {formatDurationHourLabel(duration)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ color: "var(--text-muted)" }}>
                      {weekdayFullLabel(rule.weekday)} · {formatTimeLabel(rule.hour, rule.minute ?? 0)} 시작 ·{" "}
                      {formatDurationHourLabel(normalizeSessionAddDurationHour(rule.durationHour))}
                    </div>
                  </div>
                ))}
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
