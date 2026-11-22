// v1/lib/ui/session/sessionEffective.ts
// 기존 호출부 호환용 얇은 파사드 (순수 계산은 lib/factories/sessionEffectiveCore, 저장소 접근은 lib/storage/sessionMeta)
"use client";

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

export {
  buildBaseDatesISO,
  buildUpdatedMetaMap,
  getEffectiveMetaMap,
  readMetaMap,
  resolveActiveScheduleRules,
  upsertMeta,
} from "@/lib/storage/sessionMeta";
