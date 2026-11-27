import type { BadgeStyle } from "./Badge";

export type SubmissionSummary = { done: number; total: number; hasNotice?: boolean };

const SOLID_TEXT = "#ffffff";
const SOFT: BadgeStyle = { background: "var(--surface-hover)", color: "var(--text-subtle)" };

/**
 * 회차 제출 배지: '75%' (제출한 개수 / 전체 개수)
 * - 과제 없음: '미정' (공지만 있으면 '공지')
 * - 아직 시작 전 수업: 회색 / 지난 수업 미완료: 노랑 / 다 냄: 초록. 빨강은 쓰지 않음
 */
export function getSubmissionBadge(
  summary: SubmissionSummary | null,
  isPast: boolean
): { label: string; style: BadgeStyle } {
  if (!summary || summary.total <= 0) {
    return { label: summary?.hasNotice ? "공지" : "미정", style: SOFT };
  }
  const label = `${Math.round((summary.done / summary.total) * 100)}%`;
  if (summary.done >= summary.total) return { label, style: { background: "var(--ok)", color: SOLID_TEXT } };
  if (isPast) return { label, style: { background: "var(--wait)", color: SOLID_TEXT } };
  return { label, style: { background: "var(--quiet)", color: SOLID_TEXT } };
}
