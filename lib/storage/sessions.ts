// lib/storage/sessions.ts
"use client";

import { browserStorage, watchBrowserStorageKey } from "@/lib/storage/browserStorage";
import { pushSharedSnapshot, readLocalStudents, readLocalTeachers, STUDENTS_KEY } from "@/lib/storage/sharedSnapshot";
import { safeParseJson } from "@/lib/storage/safeParse";
import {
  loadLatestCoreSnapshotBaseline,
  loadLatestCoreSnapshotBaselineServerRequired,
  mergeById,
} from "@/lib/storage/safeSnapshotMerge";
import type { Session, Student } from "@/lib/types/index";

const KEY = "tutorweb_sessions_v1";

export type SaveSessionsOptions = {
  skipSharedSnapshot?: boolean;
  snapshotMode?: "merge" | "replace";
  serverRequired?: boolean;
  previousOverride?: Session[];
};

let sessionsCache: { value: Session[]; expiry: number } | null = null;
const SESSIONS_CACHE_TTL = 50;

/** 저장소의 회차 키가 (어디서든) 바뀌면 단기 기억을 즉시 지웁니다. */
function invalidateSessionsCache(): void {
  sessionsCache = null;
}

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  watchBrowserStorageKey(KEY, invalidateSessionsCache);
  
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
  sessionsCache = null; // 저장 시 캐시 무효화
  const nextRaw = JSON.stringify(list);
  if (browserStorage.getItem(KEY) === nextRaw) return false;
  browserStorage.setItem(KEY, nextRaw);
  window.dispatchEvent(new CustomEvent("tutorweb:sessionsUpdated"));
  return true;
}

/**
 * [Safety First] 서버의 최신 데이터를 먼저 가져와서 로컬 변경사항과 병합 후 업로드
 */
async function syncSharedSnapshot(
  nextSessions: Session[],
  mode: "merge" | "replace",
  serverRequired: boolean
): Promise<void> {
  const baseline = serverRequired
    ? await loadLatestCoreSnapshotBaselineServerRequired()
    : await loadLatestCoreSnapshotBaseline();
  const mergedSessions =
    mode === "replace"
      ? nextSessions
      : mergeById(baseline.sessions, nextSessions);
  const teachers = serverRequired
    ? baseline.teachers
    : baseline.teachers.length > 0
      ? baseline.teachers
      : readLocalTeachers();
  const students = serverRequired
    ? baseline.students
    : baseline.students.length > 0
      ? baseline.students
      : readLocalStudents();

  await pushSharedSnapshot({
    teachers,
    students,
    sessions: mergedSessions,
    forceEmpty: mode === "replace" && mergedSessions.length === 0,
  });
}

/**
 * 회차 목록을 저장합니다. (저장만 합니다. 구글 캘린더는 건드리지 않습니다.)
 * 캘린더 동기화까지 필요하면 `saveSessionsAndSyncCalendar`(lib/integrations/sessionCalendarActions)를 쓰세요.
 *
 * @returns 저장 직전의 회차 목록(캘린더 동기화가 "무엇이 바뀌었는지" 비교할 때 사용). 브라우저가 아니면 null.
 */
export function saveSessions(list: Session[], options?: SaveSessionsOptions): Session[] | null {
  if (typeof window === "undefined") return null;
  sessionsCache = null; // 저장 시 캐시 무효화
  const previous = options?.previousOverride ?? loadSessions();
  
  replaceSessionsLocal(list);
  
  if (!options?.skipSharedSnapshot) {
    void syncSharedSnapshot(list, options?.snapshotMode ?? "merge", options?.serverRequired ?? false).catch((err) => {
      console.error(
        `공유 스냅샷 동기화 실패(sessions${options?.serverRequired ? ":server-required" : ""}):`,
        err
      );
    });
  }

  return previous;
}

/**
 * 서버 저장이 성공한 뒤에만 로컬에 반영합니다. (저장만 합니다. 구글 캘린더는 건드리지 않습니다.)
 * @returns 저장 직전의 회차 목록
 */
export async function saveSessionsServerFirst(
  list: Session[],
  options?: SaveSessionsOptions
): Promise<Session[]> {
  sessionsCache = null; // 저장 시 캐시 무효화
  const previous = loadSessions();
  
  await syncSharedSnapshot(list, options?.snapshotMode ?? "merge", true);
  replaceSessionsLocal(list);

  return previous;
}

/** 캘린더 동기화 엔진이 회차에 결과(eventId/meetUrl 등)를 기록할 때 쓰는 패치 함수 */
export function applySessionPatches(patches: Array<{ id: string; patch: Partial<Session> }>): void {
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
  const changedSessions: Session[] = [];
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
    changedSessions.push(merged);
    return merged;
  });

  if (!changed) return;
  // 로컬 스토리지 즉시 반영 (캘린더 동기화 루프 차단)
  replaceSessionsLocal(next);
  // [C-2 보완] 전체 스냅샷 GET->POST 덮어쓰기 대신, 캘린더 상태가 실제로 바뀐 세션만 부분 병합(merge) 전송
  void pushSharedSnapshot({
    sessions: changedSessions,
    sessionsMergeMode: "merge",
  }).catch((err) => {
    console.error("applySessionPatches: 공유 스냅샷 부분 병합 동기화 실패:", err);
  });
}

/**
 * 동기화 엔진이 student.permanentMeetUrl을 기록할 때 호출됩니다.
 * localStorage의 students 배열을 패치하고 서버에 부분 병합 업로드합니다.
 */
export function applyStudentPatches(patches: Array<{ id: string; patch: Partial<Student> }>): void {
  if (typeof window === "undefined") return;
  if (!Array.isArray(patches) || patches.length === 0) return;

  const patchById = new Map<string, Partial<Student>>();
  for (const item of patches) {
    if (!item || typeof item.id !== "string") continue;
    const prev = patchById.get(item.id) ?? {};
    patchById.set(item.id, { ...prev, ...(item.patch ?? {}) });
  }
  if (patchById.size === 0) return;

  const current = readLocalStudents();
  let changed = false;
  const changedStudents: Student[] = [];
  const next = current.map((student) => {
    const patch = patchById.get(student.id);
    if (!patch) return student;
    const same = Object.entries(patch).every(([key, value]) => {
      const k = key as keyof Student;
      return student[k] === value;
    });
    if (same) return student;
    changed = true;
    const merged = { ...student, ...patch };
    changedStudents.push(merged);
    return merged;
  });

  if (!changed) return;

  // 로컬 스토리지 즉시 갱신
  const nextRaw = JSON.stringify(next);
  browserStorage.setItem(STUDENTS_KEY, nextRaw);

  // [C-2 보완] 바뀐 학생 행만 부분 병합(merge) 전송하여 동시 수정 덮어쓰기 및 전체 스냅샷 왕복 제거
  void pushSharedSnapshot({
    students: changedStudents,
    studentsMergeMode: "merge",
  }).catch((err) => {
    console.error("applyStudentPatches: 공유 스냅샷 부분 병합 동기화 실패:", err);
  });
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
