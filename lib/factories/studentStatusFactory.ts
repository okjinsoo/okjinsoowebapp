export type PauseLifecycle = "none" | "confirmed" | "paused";
export type StudentStatusKind =
  | "new"
  | "active"
  | "need_extension";

import type { Student, Session } from "@/lib/types/index";
import { sessionsByStudent } from "@/lib/storage/sessions";
import { buildBaseDatesISO, computeEffectiveISO, readMetaMap } from "@/lib/factories/sessionFactories";
import { kstDateMs, todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";

/**
 * 휴회 상태 계산:
 * - 마지막 수업일 이전/당일: confirmed
 * - 마지막 수업일 지난 이후: paused
 */
export function computePauseLifecycle(todayYmd: string, lastClassYmd?: string | null): PauseLifecycle {
  if (!lastClassYmd) return "none";
  return todayYmd > lastClassYmd ? "paused" : "confirmed";
}

export function isPausedByLastClass(todayYmd: string, lastClassYmd?: string | null): boolean {
  return computePauseLifecycle(todayYmd, lastClassYmd) === "paused";
}

export function isPauseScheduledByLastClass(todayYmd: string, lastClassYmd?: string | null): boolean {
  return computePauseLifecycle(todayYmd, lastClassYmd) === "confirmed";
}

export function computeDaysUntilSession(todayYmd: string, targetYmd?: string | null): number | null {
  if (!targetYmd) return null;
  const todayMs = kstDateMs(todayYmd);
  const targetMs = kstDateMs(targetYmd);
  if (todayMs === null || targetMs === null) return null;
  return Math.round((targetMs - todayMs) / 86400000);
}

export function computeStudentStatusFromMetrics(params: {
  pauseLifecycle: PauseLifecycle;
  hasPendingPauseRequest: boolean;
  overdueDays: number;
  remainingCount: number;
  passedCount: number;
  daysUntilLastSession?: number | null;
}): StudentStatusKind {
  const { remainingCount, passedCount, daysUntilLastSession } = params;

  // 마지막 수업으로부터 9일 전부터 연장필요 (D-9 이하)
  const isExtensionNeeded =
    typeof daysUntilLastSession === "number"
      ? daysUntilLastSession <= 9
      : remainingCount <= 0;

  if (isExtensionNeeded) return "need_extension";
  if (passedCount <= 3) return "new";
  return "active";
}

export function computeStudentStatus(student: Student): StudentStatusKind {
  const today = todayYmdKST();
  // 휴회 정책 제거: 휴회일 입력값을 상태 계산에서 더 이상 사용하지 않는다.
  const pauseLifecycle = computePauseLifecycle(today, undefined);
  const hasPendingPauseRequest = false;

  if (!student.token) {
    return computeStudentStatusFromMetrics({
      pauseLifecycle,
      hasPendingPauseRequest,
      overdueDays: 0,
      remainingCount: Math.max(0, student.planCount ?? 0),
      passedCount: 0,
      daysUntilLastSession: null,
    });
  }

  const realSessions = sessionsByStudent(student.id);
  const planCount = student.planCount || 12;
  const sessionsByIndex = new Map(realSessions.map((session) => [session.index, session]));
  const maxIndex = Math.max(planCount, ...realSessions.map((s) => s.index), 0);
  const rawSessions: Session[] = [];
  for (let i = 1; i <= maxIndex; i += 1) {
    const existing = sessionsByIndex.get(i);
    if (existing) {
      rawSessions.push(existing);
      continue;
    }
    rawSessions.push({
      id: `virtual_${student.id}_${i}`,
      studentId: student.id,
      index: i,
      displayAt: "",
      state: "normal",
    });
  }

  const baseDatesISO = buildBaseDatesISO(student, 60);
  const metaMap = readMetaMap(student.token);
  let passedCount = 0;
  let lastSessionISO: string | null = null;
  for (const s of rawSessions) {
    const { effectiveISO } = computeEffectiveISO({
      token: student.token,
      index: s.index,
      baseDatesISO,
      metaMap,
    });
    if (!effectiveISO) continue;
    const ymd = ymdFromISO_KST(effectiveISO);
    if (ymd && ymd < today) passedCount += 1;
    if (!lastSessionISO || effectiveISO > lastSessionISO) lastSessionISO = effectiveISO;
  }

  const totalCount = Math.max(0, student.planCount ?? 0, rawSessions.length);
  const remainingCount = Math.max(0, totalCount - passedCount);
  const finishedAll = totalCount > 0 && passedCount >= totalCount;
  const lastYmd = lastSessionISO ? ymdFromISO_KST(lastSessionISO) ?? "" : "";
  const todayMs = kstDateMs(today);
  const lastMs = lastYmd ? kstDateMs(lastYmd) : null;
  const overdueDays =
    finishedAll && todayMs !== null && lastMs !== null
      ? Math.floor((todayMs - lastMs) / 86400000)
      : 0;
  const daysUntilLastSession =
    lastMs !== null && todayMs !== null
      ? Math.round((lastMs - todayMs) / 86400000)
      : null;

  return computeStudentStatusFromMetrics({
    pauseLifecycle,
    hasPendingPauseRequest,
    overdueDays,
    remainingCount,
    passedCount,
    daysUntilLastSession,
  });
}

export function getStudentStatusMeta(kind: StudentStatusKind): {
  label: string;
  tone: "green" | "gray" | "blue";
  bg: string;
  color: string;
} {
  if (kind === "new") return { label: "신규생", tone: "green", bg: "#16a34a", color: "#fff" };
  if (kind === "active") return { label: "재학생", tone: "gray", bg: "#6b7280", color: "#fff" };
  return { label: "연장필요", tone: "blue", bg: "#2563eb", color: "#fff" };
}

export function getStudentStatusSectionLabel(kind: StudentStatusKind): string {
  return getStudentStatusMeta(kind).label;
}
