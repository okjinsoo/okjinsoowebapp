import { browserStorage } from "@/lib/storage/browserStorage";
import {
  isSessionProgressStateKey,
  sessionLeafIdsKey,
  sessionProgressByLeafIdKey,
} from "@/lib/storage/sharedStateKeys";

export type SessionProgressItem = {
  noteDone?: boolean;
  solveDone?: boolean;
  wrongNoteDone?: boolean;
};

export type SessionProgressMap = Record<string, SessionProgressItem>;

export type SessionProgressSummary = {
  done: number;
  total: number;
  percent: number | null;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = browserStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function readSessionLeafIds(token: string, sessionIndex: number): string[] {
  const list = readJson<string[]>(sessionLeafIdsKey(token, sessionIndex), []);
  return Array.isArray(list) ? list : [];
}

export function readSessionProgressByLeafId(token: string, sessionIndex: number): SessionProgressMap {
  const progress = readJson<SessionProgressMap>(sessionProgressByLeafIdKey(token, sessionIndex), {});
  if (!progress || typeof progress !== "object") return {};
  return progress;
}

export function calculateSessionProgressSummary(args: {
  token: string;
  sessionIndex: number;
}): SessionProgressSummary {
  const { token, sessionIndex } = args;
  const ids = readSessionLeafIds(token, sessionIndex);
  const progress = readSessionProgressByLeafId(token, sessionIndex);

  let total = 0;
  let done = 0;

  for (const id of ids) {
    const row = progress[id];

    // 1. 공지사항 카드는 진도율 계산에서 완전히 배제
    if (id.startsWith("notice_")) {
      continue;
    }

    // 2. 임의 문제 카드는 '풀이 제출' 체크박스만 있으므로 만점이 1점
    if (id.startsWith("custom_")) {
      total += 1;
      done += row?.solveDone ? 1 : 0;
      continue;
    }

    // 3. 오답 노트 카드는 '오답 노트 제출' 체크박스만 있으므로 만점이 1점
    if (id.startsWith("wrongnote_")) {
      total += 1;
      done += row?.wrongNoteDone ? 1 : 0;
      continue;
    }

    // 4. 일반 강의 카드는 필기/풀이 두 개가 모두 있으므로 만점이 2점
    total += 2;
    done += (row?.noteDone ? 1 : 0) + (row?.solveDone ? 1 : 0);
  }

  return {
    done,
    total,
    percent: total === 0 ? null : Math.round((done / total) * 100),
  };
}

export function calculateSessionAchievementPercent(args: {
  token: string;
  sessionIndex: number;
}): number | null {
  return calculateSessionProgressSummary(args).percent;
}

export function isSessionProgressEventKey(key: string): boolean {
  return isSessionProgressStateKey(key);
}

export function isSessionProgressEventKeyForToken(key: string, token: string): boolean {
  if (!isSessionProgressStateKey(key)) return false;
  return key.startsWith(`mk3:${token}:session:`);
}
