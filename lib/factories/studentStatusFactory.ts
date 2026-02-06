export type PauseLifecycle = "none" | "confirmed" | "paused";
export type StudentStatusKind =
  | "new"
  | "active"
  | "need_extension"
  | "overdue_extension"
  | "pause_requested"
  | "pause_scheduled"
  | "paused";

import type { ConsultationRecord, Student } from "@/lib/types/index";
import { loadConsultationsByStudent } from "@/lib/storage/consultations";
import { sessionsByStudent } from "@/lib/storage/sessions";
import { buildBaseDatesISOByToken, computeEffectiveISO, readMetaMap } from "@/lib/factories/sessionFactories";
import { kstDateMs, todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";

/**
 * 휴회 상태 공장:
 * - 마지막 수업일 이전/당일: confirmed(=휴회예정)
 * - 마지막 수업일 지난 이후: paused(=휴회생)
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

export function computeStudentStatusFromMetrics(params: {
  pauseLifecycle: PauseLifecycle;
  hasPendingPauseRequest: boolean;
  overdueDays: number;
  remainingCount: number;
  passedCount: number;
}): StudentStatusKind {
  const { pauseLifecycle, hasPendingPauseRequest, overdueDays, remainingCount, passedCount } = params;
  if (pauseLifecycle === "paused") return "paused";
  if (pauseLifecycle === "confirmed") return "pause_scheduled";
  if (hasPendingPauseRequest) return "pause_requested";
  if (overdueDays > 7) return "overdue_extension";
  if (remainingCount <= 3) return "need_extension";
  if (passedCount <= 3) return "new";
  return "active";
}

export function computeStudentStatus(student: Student): StudentStatusKind {
  const today = todayYmdKST();
  const pauseLifecycle = computePauseLifecycle(today, student.pauseEffectiveDate);
  const consultRecords: ConsultationRecord[] = loadConsultationsByStudent(student.id);
  const latestPause = [...consultRecords]
    .filter((r) => r.purpose === "pause_request")
    .sort((a, b) => `${a.date ?? ""}|${a.createdAt ?? ""}`.localeCompare(`${b.date ?? ""}|${b.createdAt ?? ""}`))
    .at(-1);
  const hasPendingPauseRequest = Boolean(latestPause && !latestPause.finalResult);

  if (!student.token) {
    return computeStudentStatusFromMetrics({
      pauseLifecycle,
      hasPendingPauseRequest,
      overdueDays: 0,
      remainingCount: Math.max(0, student.planCount ?? 0),
      passedCount: 0,
    });
  }

  const sessions = sessionsByStudent(student.id);
  const baseDatesISO = buildBaseDatesISOByToken(student.token, 60);
  const metaMap = readMetaMap(student.token);
  let passedCount = 0;
  let lastSessionISO: string | null = null;
  for (const s of sessions) {
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

  const totalCount = Math.max(0, student.planCount ?? 0, sessions.length);
  const remainingCount = Math.max(0, totalCount - passedCount);
  const finishedAll = totalCount > 0 && passedCount >= totalCount;
  const lastYmd = lastSessionISO ? ymdFromISO_KST(lastSessionISO) ?? "" : "";
  const todayMs = kstDateMs(today);
  const lastMs = lastYmd ? kstDateMs(lastYmd) : null;
  const overdueDays =
    finishedAll && todayMs !== null && lastMs !== null
      ? Math.floor((todayMs - lastMs) / 86400000)
      : 0;

  return computeStudentStatusFromMetrics({
    pauseLifecycle,
    hasPendingPauseRequest,
    overdueDays,
    remainingCount,
    passedCount,
  });
}

export function getStudentStatusMeta(kind: StudentStatusKind): {
  label: string;
  tone: "green" | "gray" | "blue" | "red" | "orange";
  bg: string;
  color: string;
} {
  if (kind === "new") return { label: "신규생", tone: "green", bg: "#16a34a", color: "#fff" };
  if (kind === "active") return { label: "재학생", tone: "gray", bg: "#6b7280", color: "#fff" };
  if (kind === "need_extension") return { label: "연장필요", tone: "blue", bg: "#2563eb", color: "#fff" };
  if (kind === "overdue_extension") return { label: "미연장생", tone: "red", bg: "#dc2626", color: "#fff" };
  if (kind === "pause_requested") return { label: "휴회요청", tone: "orange", bg: "#f97316", color: "#fff" };
  if (kind === "pause_scheduled") return { label: "휴회예정", tone: "red", bg: "#dc2626", color: "#fff" };
  return { label: "휴회생", tone: "red", bg: "#dc2626", color: "#fff" };
}

export function getStudentStatusSectionLabel(kind: StudentStatusKind): string {
  return getStudentStatusMeta(kind).label;
}
