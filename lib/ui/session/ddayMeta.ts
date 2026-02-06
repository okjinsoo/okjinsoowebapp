// v1/lib/ui/session/ddayMeta.ts
// D-day "계산 + 색 규칙"만 담당하는 레고 (디자인 제외)

import { dayDiffLocal, ddayClass } from "@/lib/ui/session/format";

export type DdayMeta = {
  /** 날짜 계산이 가능하면 number, 불가하면 null */
  diff: number | null;
  /** UI에서 그대로 써도 되는 문자열 */
  label: string; // "D-day" | "D-3" | "D+2" | "-"
  /** 색 규칙 결과 (tailwind class) */
  className: string;
};

/**
 * effectiveISO(수업일시 ISO 문자열)로 D-day 정보를 만든다.
 * - 디자인은 UI에서 책임진다.
 * - 색 규칙은 ddayClass(diff)를 그대로 사용한다.
 *
 * 주의:
 * - SSR/하이드레이션 이슈를 피하려면, UI에서 mounted 이후에 호출하는 것을 권장.
 */
export function getDdayMeta(effectiveISO: string | null | undefined, now: Date = new Date()): DdayMeta {
  if (!effectiveISO) {
    return { diff: null, label: "-", className: "bg-slate-400" };
  }

  const dt = new Date(effectiveISO);
  if (!Number.isFinite(dt.getTime())) {
    return { diff: null, label: "-", className: "bg-slate-400" };
  }

  const diff = dayDiffLocal(now, dt);
  const label =
    diff === 0 ? "D-day" : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;

  return {
    diff,
    label,
    className: ddayClass(diff),
  };
}
