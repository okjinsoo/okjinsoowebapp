// v1/lib/factories/sessionFactories.ts
// ✅ Session 관련 계산/저장 공장들의 단일 입구
// 사용법(간단):
// - 화면에서는 가능하면 이 파일만 import 하세요.
// - 원본 날짜: buildBaseDatesISO / buildBaseDatesISOByToken
// - 기록(출결/변경/이월): readMetaMap / upsertMeta
// - 최종 날짜: computeEffectiveISO
// - D-day: getDdayMeta
// - 반응형 훅: useMetaMap / useMetaSignal

export {
  buildBaseDatesISO,
  buildBaseDatesISOByToken,
  buildBadges,
  computeEffectiveISO,
  getStatusStyle,
  metaMapKey,
  readMetaMap,
  upsertMeta,
  type SessionMeta,
  type SessionState,
} from "@/lib/ui/session/sessionEffective";

export { getDdayMeta, type DdayMeta } from "@/lib/ui/session/ddayMeta";

export { useMetaMap, useMetaSignal } from "@/lib/ui/session/useMetaMap";

export type SessionVisibility = "visible" | "hidden";

export function getSessionVisibility(args: {
  index: number;
  lastVisibleIndex?: number | null;
}): SessionVisibility {
  const { index, lastVisibleIndex } = args;
  if (lastVisibleIndex && index > lastVisibleIndex) return "hidden";
  return "visible";
}
