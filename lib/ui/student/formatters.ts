// v1/lib/ui/student/formatters.ts
// 공통 포맷 유틸(학생 UI 전용)
import type { ScheduleRule } from "@/lib/types/index";
import { formatPhone as formatPhoneBase } from "@/lib/utils/phone";

export function formatPhone(n: string) {
  return formatPhoneBase(n);
}

export function formatSchedule(rules: ScheduleRule[]): string {
  if (!Array.isArray(rules) || rules.length === 0) return "";
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const sorted = [...rules].sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    if (a.hour !== b.hour) return a.hour - b.hour;
    return a.minute - b.minute;
  });

  return sorted
    .map((r) => {
      const wd = weekdays[r.weekday] ?? "?";
      const hh = String(r.hour).padStart(2, "0");
      const mm = String(r.minute).padStart(2, "0");
      return `${wd} ${hh}:${mm}`;
    })
    .join(" · ");
}

export function formatGrade(raw?: string) {
  const g = String(raw ?? "").trim();
  if (!g) return "-";
  if (g === "N수") return g;
  if (/^\d+$/.test(g)) {
    const n = Number(g);
    if (!Number.isFinite(n)) return g;
    if (n >= 1 && n <= 6) return `초${n}`;
    if (n >= 7 && n <= 9) return `중${n - 6}`;
    if (n >= 10 && n <= 12) return `고${n - 9}`;
    return g;
  }
  return g;
}
