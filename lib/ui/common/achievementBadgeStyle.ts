import type { BadgeStyle } from "./Badge";

export type SubmissionSummary = { done: number; total: number; hasNotice?: boolean };

const BADGE_TEXT = "#ffffff";
const SOFT: BadgeStyle = { background: "var(--surface-hover)", color: "var(--text-subtle)" };

/**
 * 회차 제출 배지: '75%' (제출한 개수 / 전체 개수)
 * - 과제 없음: '미정' (공지만 있으면 '공지')
 * - 색: 50% 이하 빨강 / 77% 이하 주황 / 90% 이하 파랑 / 그 위 초록
 */
export function getSubmissionBadge(summary: SubmissionSummary | null): { label: string; style: BadgeStyle } {
  if (!summary || summary.total <= 0) {
    return { label: summary?.hasNotice ? "공지" : "미정", style: SOFT };
  }
  const score = Math.round((summary.done / summary.total) * 100);
  const label = `${score}%`;
  if (score <= 50) return { label, style: { background: "#dc2626", color: BADGE_TEXT } };
  if (score <= 77) return { label, style: { background: "#ea580c", color: BADGE_TEXT } };
  if (score <= 90) return { label, style: { background: "#2563eb", color: BADGE_TEXT } };
  return { label, style: { background: "#16a34a", color: BADGE_TEXT } };
}
