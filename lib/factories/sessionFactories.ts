// v1/lib/factories/sessionFactories.ts
// ✅ Session 관련 순수 계산 공장들의 단일 입구 (UI/브라우저 저장소 의존 없음)
// - 브라우저 저장소 읽기/쓰기(readMetaMap, upsertMeta, buildBaseDatesISO 등)는 "@/lib/storage/sessionMeta" 사용
// - React 훅(useMetaMap, useMetaSignal)은 화면 세션 훅 모듈(useMetaMap.ts)에서 직접 import

export type { SessionMeta, SessionMetaStatus } from "@/lib/types/index";

export {
  buildBadges,
  buildBaseDatesISOFromMetaMap,
  buildUpdatedMetaMapFromCurrent,
  computeEffectiveISO,
  getStatusStyle,
  mergeEffectiveMetaMap,
  metaMapKey,
  parseMetaMapFromRaw,
  resolveActiveScheduleRulesCore,
  ymdFromISO_KST,
} from "@/lib/factories/sessionEffectiveCore";

export { getDdayMeta, type DdayMeta } from "@/lib/factories/ddayMeta";

export type SessionVisibility = "visible" | "hidden";

export function getSessionVisibility(args: {
  index: number;
  lastVisibleIndex?: number | null;
}): SessionVisibility {
  const { index, lastVisibleIndex } = args;
  if (lastVisibleIndex && index > lastVisibleIndex) return "hidden";
  return "visible";
}
