import type { SessionMeta, SessionState } from "@/lib/factories/sessionFactories";
import type { ScheduleRule, Student } from "@/lib/types/index";
import { getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";

export type SessionCardDday = {
  diff: number | null;
  label: string;
  className: string;
} | null;

export type SessionCardBadgeView = {
  label: string;
  style: { background: string; color: string };
};

export type SessionCardViewModel = {
  index: number;
  title: string;
  dateTimeText: string;
  dday: SessionCardDday;
  achievementPercent: number | null;
  statusBadge: {
    label: "출석" | "결석" | "예정";
    style: { background: string; color: string };
  };
  extraBadges: SessionCardBadgeView[];
};

type BuildSessionCardViewArgs = {
  index: number;
  dateTimeText: string;
  dday: SessionCardDday;
  status: SessionState | undefined;
  achievementPercent: number | null;
  extraBadges?: string[];
  hiddenBadgeLabels?: string[];
};

export function buildSessionCardViewModel(args: BuildSessionCardViewArgs): SessionCardViewModel {
  const hidden = new Set(args.hiddenBadgeLabels ?? []);
  const extraBadges = (args.extraBadges ?? [])
    .filter((label) => !hidden.has(label))
    .map((label) => ({
      label,
      style: getSessionExtraBadgeStyle(label),
    }));
  return {
    index: args.index,
    title: `${args.index}회차`,
    dateTimeText: args.dateTimeText,
    dday: args.dday,
    achievementPercent: args.achievementPercent,
    statusBadge: getSessionStatusBadge(args.status),
    extraBadges,
  };
}

function normalizeDurationMin(value: number): number {
  if (!Number.isFinite(value)) return 60;
  return Math.max(30, Math.round(value));
}

function kstWeekdayHourMinuteFromISO(iso: string): { weekday: number; hour: number; minute: number } | null {
  try {
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const wk = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = map[wk];
    if (!Number.isFinite(weekday) || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
    return { weekday, hour: hh, minute: mm };
  } catch {
    return null;
  }
}

export function resolveRulesForIndex(student: Student, index: number): ScheduleRule[] {
  const events = [...(student.scheduleChangeEvents ?? [])].sort((a, b) => a.startIndex - b.startIndex);
  let rules = [...(student.scheduleRules ?? [])];
  for (const event of events) {
    if (event.startIndex <= index && Array.isArray(event.newRules) && event.newRules.length > 0) {
      rules = [...event.newRules];
    }
  }
  return rules;
}

export function resolveDurationMinForSession(iso: string | null | undefined, rules: ScheduleRule[]): number {
  return resolveDurationMinForSessionWithMeta(iso, rules, undefined);
}

export function resolveDurationMinForSessionWithMeta(
  iso: string | null | undefined,
  rules: ScheduleRule[],
  meta: SessionMeta | undefined
): number {
  const overrideDurationMin = Number(meta?.overrideDurationMin);
  if (Number.isFinite(overrideDurationMin) && overrideDurationMin > 0) {
    return normalizeDurationMin(overrideDurationMin);
  }
  const normalizedRules = rules
    .map((rule) => ({
      weekday: Number(rule.weekday),
      hour: Math.max(0, Math.min(23, Math.floor(Number(rule.hour) || 0))),
      minute: Math.max(0, Math.min(59, Math.floor(Number(rule.minute) || 0))),
      durationMin: normalizeDurationMin(Number(rule.durationMin)),
    }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
  if (normalizedRules.length === 0) return 60;
  if (!iso) return normalizedRules[0].durationMin;
  const key = kstWeekdayHourMinuteFromISO(iso);
  if (!key) return normalizedRules[0].durationMin;
  const matched = normalizedRules.find(
    (rule) => rule.weekday === key.weekday && rule.hour === key.hour && rule.minute === key.minute
  );
  return (matched ?? normalizedRules[0]).durationMin;
}
