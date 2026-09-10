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
    let hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    if (hh === 24) hh = 0;
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = map[wk];
    if (weekday === undefined || !Number.isFinite(weekday) || !Number.isFinite(hh) || !Number.isFinite(mm)) return null;
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

  // paymentHistory에 sessionAddRules가 있는 경우 durationMin 보강
  const payments = [...(student.paymentHistory ?? [])].sort((a, b) => (a.startIndex || 0) - (b.startIndex || 0));
  for (const p of payments) {
    if (p.startIndex <= index && index <= p.endIndex && Array.isArray(p.sessionAddRules) && p.sessionAddRules.length > 0) {
      const pRules = p.sessionAddRules;
      rules = rules.map((r, i) => {
        const pRule = pRules[i % pRules.length];
        const pDurMin = pRule?.durationHour ? Math.round(pRule.durationHour * 60) : undefined;
        return {
          ...r,
          durationMin: r.durationMin || pDurMin || 60,
        };
      });
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

  // 1. 요일과 시/분이 정확히 일치하는 규칙
  const exactMatched = normalizedRules.find(
    (rule) => rule.weekday === key.weekday && rule.hour === key.hour && rule.minute === key.minute
  );
  if (exactMatched) return exactMatched.durationMin;

  // 2. 요일만 일치하는 규칙 (시간이 약간 변경된 경우)
  const weekdayMatched = normalizedRules.find((rule) => rule.weekday === key.weekday);
  if (weekdayMatched) return weekdayMatched.durationMin;

  // 3. 첫 번째 유효 규칙의 durationMin
  return normalizedRules[0].durationMin;
}
