"use client";

import { computeEffectiveISO } from "@/lib/factories/sessionFactories";
import { ymdFromISO_KST } from "@/lib/utils/date";
import type { SessionMeta } from "@/lib/factories/sessionFactories";
import type { Session } from "@/lib/types/index";

type SessionMetaMap = Record<number, SessionMeta>;

export function findLastClassIndex(params: {
  token: string;
  sessions: Session[];
  baseDatesISO: string[];
  metaMap: SessionMetaMap;
  pauseEffectiveDate?: string;
}): number | null {
  const { token, sessions, baseDatesISO, metaMap, pauseEffectiveDate } = params;
  if (!pauseEffectiveDate || sessions.length === 0) return null;

  let bestIndex: number | null = null;
  let bestTime = -Infinity;

  for (const s of sessions) {
    const { effectiveISO } = computeEffectiveISO({
      token,
      index: s.index,
      baseDatesISO,
      metaMap,
    });
    if (!effectiveISO) continue;
    const ymd = ymdFromISO_KST(effectiveISO);
    if (!ymd) continue;
    if (ymd > pauseEffectiveDate) continue;
    const timeMs = new Date(effectiveISO).getTime();
    if (!Number.isFinite(timeMs)) continue;
    if (timeMs > bestTime) {
      bestTime = timeMs;
      bestIndex = s.index;
    }
  }

  return bestIndex;
}

export function findClassIndexByDatePreferFuture(params: {
  token: string;
  sessions: Session[];
  baseDatesISO: string[];
  metaMap: SessionMetaMap;
  targetDate?: string;
}): number | null {
  const { token, sessions, baseDatesISO, metaMap, targetDate } = params;
  if (!targetDate || sessions.length === 0) return null;

  const targetMs = new Date(`${targetDate}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(targetMs)) return null;

  const sameOrFuture: { index: number; ms: number }[] = [];
  const past: { index: number; ms: number }[] = [];

  for (const s of sessions) {
    const { effectiveISO } = computeEffectiveISO({
      token,
      index: s.index,
      baseDatesISO,
      metaMap,
    });
    if (!effectiveISO) continue;
    const ymd = ymdFromISO_KST(effectiveISO);
    if (!ymd) continue;
    const ms = new Date(`${ymd}T00:00:00+09:00`).getTime();
    if (!Number.isFinite(ms)) continue;
    if (ms >= targetMs) sameOrFuture.push({ index: s.index, ms });
    else past.push({ index: s.index, ms });
  }

  if (sameOrFuture.length > 0) {
    sameOrFuture.sort((a, b) => a.ms - b.ms || a.index - b.index);
    return sameOrFuture[0].index;
  }
  if (past.length > 0) {
    past.sort((a, b) => b.ms - a.ms || b.index - a.index);
    return past[0].index;
  }
  return null;
}
