// v1/lib/storage/sessionMeta.ts
// 브라우저 저장소(browserStorage) + 공유 스냅샷 기반 metaMap 읽기/쓰기 껍데기
"use client";

import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { todayYmdKST } from "@/lib/utils/date";
import {
  buildBaseDatesISOFromMetaMap,
  buildUpdatedMetaMapFromCurrent,
  mergeEffectiveMetaMap,
  metaMapKey,
  parseMetaMapFromRaw,
  resolveActiveScheduleRulesCore,
} from "@/lib/factories/sessionEffectiveCore";
import type { ScheduleRule, SessionMeta, Student } from "@/lib/types/index";

export function readMetaMap(token: string): Record<number, SessionMeta> {
  if (!token) return {};
  try {
    const raw = browserStorage.getItem(metaMapKey(token));
    return parseMetaMapFromRaw(raw);
  } catch {
    return {};
  }
}

export function buildUpdatedMetaMap(
  token: string,
  index: number,
  patch: Partial<SessionMeta>
): {
  key: string;
  raw: string;
  nextMetaMap: Record<number, SessionMeta>;
  nextMeta: SessionMeta;
} {
  return buildUpdatedMetaMapFromCurrent(readMetaMap(token), token, index, patch);
}

async function writeMetaMap(token: string, metaMap: Record<number, SessionMeta>) {
  if (typeof window === "undefined") return;
  const key = metaMapKey(token);
  const raw = JSON.stringify(metaMap);
  // 직접 pushSharedSnapshot을 호출하므로 setItemSilent를 사용하여 SharedSnapshotAgent의 700ms 뒤 중복 POST를 차단한다.
  browserStorage.setItemSilent(key, raw);
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
  const queueRetry = () => {
    window.dispatchEvent(
      new CustomEvent(BROWSER_STORAGE_EVENT, {
        detail: { type: "set", key, oldValue: null, newValue: raw },
      })
    );
  };
  try {
    const result = await pushSharedSnapshot({
      stateKv: {
        [key]: raw,
      },
    });
    if (!result.stateKvSynced) {
      // 서버 반영 실패 시에만 SharedSnapshotAgent 재시도 큐에 태운다.
      queueRetry();
    }
  } catch (err) {
    console.error("공유 스냅샷 동기화 실패(metaMap):", err);
    queueRetry();
  }
}

export function getEffectiveMetaMap(args: {
  token: string;
  stateKv?: Record<string, string>;
}): Record<number, SessionMeta> {
  const { token, stateKv } = args;
  if (!token) return {};

  const serverRaw = stateKv ? stateKv[metaMapKey(token)] : undefined;
  const serverMeta = parseMetaMapFromRaw(serverRaw);
  const localMeta = readMetaMap(token);

  // 서버 메타를 기본으로 두고, 같은 회차에 로컬 변경이 있으면 로컬 값을 우선 병합합니다.
  return mergeEffectiveMetaMap(serverMeta, localMeta);
}

export async function upsertMeta(
  token: string,
  index: number,
  patch: Partial<SessionMeta>
): Promise<SessionMeta> {
  const { nextMetaMap, nextMeta } = buildUpdatedMetaMap(token, index, patch);
  await writeMetaMap(token, nextMetaMap);
  return nextMeta;
}

/**
 * metaMapOverride가 생략되면 브라우저 저장소(readMetaMap)에서 읽어 baseDatesISO를 계산합니다.
 */
export function buildBaseDatesISO(
  student: Student,
  extra = 60,
  metaMapOverride?: Record<number, SessionMeta>
): string[] {
  const resolvedMetaMap = metaMapOverride ?? readMetaMap(student.token ?? "");
  return buildBaseDatesISOFromMetaMap(student, extra, resolvedMetaMap);
}

/**
 * targetYmd/metaMap이 생략되면 오늘(KST)과 브라우저 저장소(readMetaMap)에서 읽어 활성 시간표를 계산합니다.
 */
export function resolveActiveScheduleRules(args: {
  student?: Student | null;
  targetYmd?: string;
  baseDatesISO?: string[];
  metaMap?: Record<number, SessionMeta>;
}): ScheduleRule[] {
  const { student, targetYmd, baseDatesISO, metaMap } = args;
  if (!student) return [];
  const resolvedMetaMap = metaMap ?? (student.token ? readMetaMap(student.token) : {});
  return resolveActiveScheduleRulesCore({
    student,
    targetYmd: targetYmd || todayYmdKST(),
    baseDatesISO,
    metaMap: resolvedMetaMap,
  });
}
