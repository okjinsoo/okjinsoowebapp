// lib/storage/sessions.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { pushSharedSnapshot, readLocalSessions, readLocalStudents, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import {
  rebuildTeacherGoogleCalendar,
  scheduleGoogleCalendarSync,
  syncStudentGoogleCalendarMirror,
} from "@/lib/integrations/googleCalendarSync";
import { safeParseJson } from "@/lib/storage/safeParse";
import { mergeById } from "@/lib/storage/safeSnapshotMerge";
import type { Session } from "@/lib/types/index";

const KEY = "tutorweb_sessions_v1";

type SaveSessionsOptions = {
  suppressCalendarSync?: boolean;
  skipSharedSnapshot?: boolean;
  snapshotMode?: "merge" | "replace";
};

let sessionsCache: { value: Session[]; expiry: number } | null = null;
const SESSIONS_CACHE_TTL = 50;

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  
  const now = Date.now();
  if (sessionsCache && sessionsCache.expiry > now) {
    return sessionsCache.value;
  }

  const raw = browserStorage.getItem(KEY);
  const value = safeParseJson<Session[]>(raw, []);
  
  sessionsCache = { value, expiry: now + SESSIONS_CACHE_TTL };
  return value;
}

function replaceSessionsLocal(list: Session[]): boolean {
  if (typeof window === "undefined") return false;
  const nextRaw = JSON.stringify(list);
  if (browserStorage.getItem(KEY) === nextRaw) return false;
  browserStorage.setItem(KEY, nextRaw);
  window.dispatchEvent(new CustomEvent("tutorweb:sessionsUpdated"));
  return true;
}

// [최적화] 서버에서 다시 pull하지 않고, 이미 로컬에 있는 데이터를 바로 사용하여 push 1회만 수행
function syncSharedSnapshot(nextSessions: Session[], mode: "merge" | "replace"): void {
  void (async () => {
    // 로컬 데이터를 직접 사용 (서버 왕복 1번 절약)
    const localSessions = readLocalSessions();
    const mergedSessions = mode === "replace"
      ? nextSessions
      : mergeById(localSessions, nextSessions);

    await pushSharedSnapshot({
      teachers: readLocalTeachers(),
      students: readLocalStudents(),
      sessions: mergedSessions,
    });
  })().catch((err) => {
    console.error("공유 스냅샷 동기화 실패(sessions):", err);
  });
}

function persistSessions(list: Session[], options?: { skipSharedSnapshot?: boolean }): void {
  if (typeof window === "undefined") return;
  browserStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("tutorweb:sessionsUpdated"));
  if (!options?.skipSharedSnapshot) {
    syncSharedSnapshot(list, "merge");
  }
}

function applySessionPatches(patches: Array<{ id: string; patch: Partial<Session> }>): void {
  if (typeof window === "undefined") return;
  if (!Array.isArray(patches) || patches.length === 0) return;

  const patchById = new Map<string, Partial<Session>>();
  for (const item of patches) {
    if (!item || typeof item.id !== "string") continue;
    const prev = patchById.get(item.id) ?? {};
    patchById.set(item.id, { ...prev, ...(item.patch ?? {}) });
  }
  if (patchById.size === 0) return;

  const current = loadSessions();
  let changed = false;
  const next = current.map((session) => {
    const patch = patchById.get(session.id);
    if (!patch) return session;
    const merged = { ...session, ...patch };
    const same = Object.entries(patch).every(([key, value]) => {
      const k = key as keyof Session;
      return session[k] === value;
    });
    if (same) return session;
    changed = true;
    return merged;
  });

  if (!changed) return;
  persistSessions(next);
}

function applyCalendarResyncPatch(args: {
  studentIds: Set<string>;
  teacherEmailChanged?: boolean;
  reason: string;
}): void {
  if (args.studentIds.size === 0) return;
  const current = loadSessions();
  let changed = false;

  const next = current.map((session) => {
    if (!args.studentIds.has(session.studentId)) return session;

    const patch: Partial<Session> = {
      googleCalendarStatus: "pending",
      googleCalendarError: args.reason,
    };

    if (args.teacherEmailChanged) {
      patch.googleCalendarOwnerEmail = undefined;
      patch.googleCalendarEventId = undefined;
      patch.googleMeetUrl = undefined;
    }

    const same = Object.entries(patch).every(([key, value]) => {
      const k = key as keyof Session;
      return session[k] === value;
    });
    if (same) return session;

    changed = true;
    return {
      ...session,
      ...patch,
    };
  });

  if (!changed) return;
  saveSessions(next);
}

export function saveSessions(list: Session[], options?: SaveSessionsOptions): void {
  const previous = loadSessions();
  persistSessions(list, { skipSharedSnapshot: true });
  if (!options?.skipSharedSnapshot) {
    syncSharedSnapshot(list, options?.snapshotMode ?? "merge");
  }

  if (options?.suppressCalendarSync) return;

  scheduleGoogleCalendarSync({
    previous,
    next: list,
    applyPatches: applySessionPatches,
  });
}

export async function saveSessionsServerFirst(
  list: Session[],
  options?: SaveSessionsOptions
): Promise<void> {
  const previous = loadSessions();
  await pushSharedSnapshot({
    teachers: readLocalTeachers(),
    students: readLocalStudents(),
    sessions: list,
  });
  persistSessions(list, { skipSharedSnapshot: true });

  if (options?.suppressCalendarSync) return;

  scheduleGoogleCalendarSync({
    previous,
    next: list,
    applyPatches: applySessionPatches,
  });
}

export function syncGoogleCalendarForExistingSessions(): void {
  const current = loadSessions();
  if (current.length === 0) return;

  // 기존 회차 중 eventId/meetUrl 미동기화 항목을 한 번에 동기화
  scheduleGoogleCalendarSync({
    previous: current,
    next: current,
    applyPatches: applySessionPatches,
  });
}

export function syncStudentGoogleCalendarMirrorForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  syncStudentGoogleCalendarMirror({
    studentIds,
    sessions: loadSessions(),
  });
}

export function rebuildTeacherGoogleCalendarForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const current = loadSessions();
  rebuildTeacherGoogleCalendar({
    studentIds,
    sessions: current,
    applyPatches: applySessionPatches,
  });
}

export function requestCalendarResyncForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const set = new Set(studentIds.filter((id) => typeof id === "string" && id.trim()));
  if (set.size === 0) return;

  applyCalendarResyncPatch({
    studentIds: set,
    reason: "학생 이메일 변경 반영을 위해 Meet 참석자를 다시 동기화합니다.",
  });
}

export function requestCalendarResyncForTeacherIds(teacherIds: string[]): void {
  if (!Array.isArray(teacherIds) || teacherIds.length === 0) return;
  const teacherSet = new Set(teacherIds.filter((id) => typeof id === "string" && id.trim()));
  if (teacherSet.size === 0) return;

  const students = readLocalStudents();
  const studentIds = students
    .filter((student) => student.teacherId && teacherSet.has(student.teacherId))
    .map((student) => student.id);

  applyCalendarResyncPatch({
    studentIds: new Set(studentIds),
    teacherEmailChanged: true,
    reason: "담당 선생님 이메일 변경으로 Meet 일정을 다시 생성합니다.",
  });
}

export function upsertSession(session: Session): Session[] {
  const list = loadSessions();
  const idx = list.findIndex((x) => x.id === session.id);
  if (idx >= 0) list[idx] = session;
  else list.push(session);
  saveSessions(list);
  return list;
}

// ✅ 아래 함수들을 lib/storage/sessions.ts에 추가하세요.
// (기존 KEY / loadSessions / upsertSession 스타일을 그대로 따릅니다.)
export function removeSessionsByStudentId(studentId: string): Session[] {
  const list = loadSessions().filter((s) => s.studentId !== studentId);
  saveSessions(list, { snapshotMode: "replace" });
  return list;
}

export function removeSessionsByStudentIds(studentIds: string[]): Session[] {
  const set = new Set(studentIds);
  const list = loadSessions().filter((s) => !set.has(s.studentId));
  saveSessions(list, { snapshotMode: "replace" });
  return list;
}

export function removeSession(sessionId: string): Session[] {
  const list = loadSessions().filter((x) => x.id !== sessionId);
  saveSessions(list, { snapshotMode: "replace" });
  return list;
}

export function sessionsByStudent(studentId: string): Session[] {
  const allSessions = loadSessions();
  const realSessions = allSessions
    .filter((x) => x.studentId === studentId)
    .sort((a, b) => a.index - b.index);

  // 학생의 planCount를 확인하여 부족한 회차를 가상(Virtual)으로 채웁니다.
  const student = readLocalStudents().find(s => s.id === studentId);
  if (!student) return realSessions;

  const planCount = student.planCount || 12;
  const sessionsByIndex = new Map(realSessions.map(s => [s.index, s]));
  
  const results: Session[] = [];
  for (let i = 1; i <= planCount; i++) {
    const existing = sessionsByIndex.get(i);
    if (existing) {
      results.push(existing);
    } else {
      // 실재하지 않는 회차는 가상 객체로 생성 (DB 저장 안 함)
      results.push({
        id: `virtual_${studentId}_${i}`,
        studentId,
        index: i,
        displayAt: "", // UI에서 computeEffectiveISO로 계산하므로 비워둠
        state: "normal",
      });
    }
  }

  return results;
}

// -------------------- Student progress (mk3:* items) --------------------

type SessionItem = {
  noteDone: boolean;
  solveDone: boolean;
  [key: string]: unknown;
};

// SessionClientCore에서 사용하는 키 규칙과 동일하게 유지
function itemsKey(token: string, sessionIndex: number) {
  return `mk3:${token}:session:${sessionIndex}:items`;
}

/**
 * 학생 성취도 items 전체 로드
 * [최적화] planCount번 순차 조회 → 전체 키 1회 스캔으로 개선
 * - 수업이 아무리 많아도 순회 횟수는 Storage 전체 키 수로 고정
 * - JSON 파싱 실패/손상 데이터는 해당 회차를 건너뜀
 */
export function loadSessionItemsMap(
  token: string,
  planCount: number
): Record<number, SessionItem[]> {
  if (typeof window === "undefined") return {};

  const prefix = `mk3:${token}:session:`;
  const suffix = ":items";
  const map: Record<number, SessionItem[]> = {};

  // Storage 전체 키를 1번만 순회 (N번 getItem 호출 대신)
  for (let i = 0; i < browserStorage.length; i++) {
    const key = browserStorage.key(i);
    if (!key || !key.startsWith(prefix) || !key.endsWith(suffix)) continue;

    // prefix와 suffix 사이에서 index 추출
    const mid = key.slice(prefix.length, key.length - suffix.length);
    const index = parseInt(mid, 10);
    if (!Number.isFinite(index) || index < 1 || index > planCount) continue;

    try {
      const raw = browserStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) map[index] = parsed as SessionItem[];
    } catch {
      // ignore
    }
  }
  return map;
}

/** (선택) 디버그용 초기화 */
export function clearSessions(): void {
  if (typeof window === "undefined") return;
  browserStorage.removeItem(KEY);
  syncSharedSnapshot([], "replace");
}
