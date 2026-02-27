import { browserStorage } from "@/lib/storage/browserStorage";
import {
  isSessionProgressStateKey,
  sessionLeafIdsKey,
  sessionProgressByLeafIdKey,
} from "@/lib/storage/sharedStateKeys";

export type SessionProgressItem = {
  noteDone?: boolean;
  solveDone?: boolean;
};

export type SessionProgressMap = Record<string, SessionProgressItem>;

export type SessionProgressSummary = {
  done: number;
  total: number;
  percent: number;
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

  const total = ids.length * 2;
  const done = ids.reduce((acc, id) => {
    const row = progress[id];
    return acc + (row?.noteDone ? 1 : 0) + (row?.solveDone ? 1 : 0);
  }, 0);

  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

export function calculateSessionAchievementPercent(args: {
  token: string;
  sessionIndex: number;
}): number {
  return calculateSessionProgressSummary(args).percent;
}

export function isSessionProgressEventKey(key: string): boolean {
  return isSessionProgressStateKey(key);
}

export function isSessionProgressEventKeyForToken(key: string, token: string): boolean {
  if (!isSessionProgressStateKey(key)) return false;
  return key.startsWith(`mk3:${token}:session:`);
}
