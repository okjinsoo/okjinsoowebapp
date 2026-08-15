// lib/storage/sessions.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { pushSharedSnapshot, readLocalStudents, readLocalTeachers, STUDENTS_KEY } from "@/lib/storage/sharedSnapshot";
import {
  rebuildTeacherGoogleCalendar,
  scheduleGoogleCalendarSync,
  syncStudentGoogleCalendarMirror,
} from "@/lib/integrations/googleCalendarSync";
import { safeParseJson } from "@/lib/storage/safeParse";
import {
  loadLatestCoreSnapshotBaseline,
  loadLatestCoreSnapshotBaselineServerRequired,
  mergeById,
} from "@/lib/storage/safeSnapshotMerge";
import type { Session, Student } from "@/lib/types/index";

const KEY = "tutorweb_sessions_v1";

type SaveSessionsOptions = {
  suppressCalendarSync?: boolean;
  skipSharedSnapshot?: boolean;
  snapshotMode?: "merge" | "replace";
  serverRequired?: boolean;
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

export function saveSessions(list: Session[], options?: SaveSessionsOptions): void {
  if (typeof window === "undefined") return;
  sessionsCache = null; // 저장 시 캐시 무효화
  const previous = loadSessions();
  
  replaceSessionsLocal(list);
  
  if (!options?.skipSharedSnapshot) {
    void syncSharedSnapshot(list, options?.snapshotMode ?? "merge", options?.serverRequired ?? false).catch((err) => {
      console.error(
        `공유 스냅샷 동기화 실패(sessions${options?.serverRequired ? ":server-required" : ""}):`,
        err
      );
    });
  }

  if (options?.suppressCalendarSync) return;

  scheduleGoogleCalendarSync({
    previous,
    next: list,
    applyPatches: applySessionPatches,
    applyStudentPatch: applyStudentPatches,
  });
}

export async function saveSessionsServerFirst(
  list: Session[],
  options?: SaveSessionsOptions
): Promise<void> {
  sessionsCache = null; // 저장 시 캐시 무효화
  const previous = loadSessions();
  
  await syncSharedSnapshot(list, options?.snapshotMode ?? "merge", true);
  replaceSessionsLocal(list);

  if (options?.suppressCalendarSync) return;

  scheduleGoogleCalendarSync({
    previous,
    next: list,
    applyPatches: applySessionPatches,
    applyStudentPatch: applyStudentPatches,
  });
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
  // 캘린더 동기화 엔진이 만든 상태 패치(synced/error)를 다시 동기화 엔진에 재주입하지 않도록 차단
  saveSessions(next, {
    skipSharedSnapshot: false,
    serverRequired: true,
    suppressCalendarSync: true,
  });
}

/**
 * 동기화 엔진이 student.permanentMeetUrl을 기록할 때 호출됩니다.
 * localStorage의 students 배열을 패치하고 서버에 업로드합니다.
 */
function applyStudentPatches(patches: Array<{ id: string; patch: Partial<Student> }>): void {
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
  const next = current.map((student) => {
    const patch = patchById.get(student.id);
    if (!patch) return student;
    const same = Object.entries(patch).every(([key, value]) => {
      const k = key as keyof Student;
      return student[k] === value;
    });
    if (same) return student;
    changed = true;
    return { ...student, ...patch };
  });

  if (!changed) return;

  // 로컬 스토리지 즉시 갱신
  const nextRaw = JSON.stringify(next);
  browserStorage.setItem(STUDENTS_KEY, nextRaw);

  // 서버 스냅샷에도 반영 (suppressCalendarSync: true로 루프 방지)
  void syncSharedSnapshot(loadSessions(), "merge", true).catch((err) => {
    console.error("applyStudentPatches: 공유 스냅샷 동기화 실패:", err);
  });
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
  saveSessions(next, { serverRequired: true });
}

export function syncGoogleCalendarForExistingSessions(): void {
  const current = loadSessions();
  if (current.length === 0) return;

  // 기존 회차 중 eventId/meetUrl 미동기화 항목을 한 번에 동기화
  scheduleGoogleCalendarSync({
    previous: current,
    next: current,
    applyPatches: applySessionPatches,
    applyStudentPatch: applyStudentPatches,
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
    applyStudentPatch: applyStudentPatches,
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

export function requestCalendarResyncForStudentIdsByAdmin(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const set = new Set(studentIds.filter((id) => typeof id === "string" && id.trim()));
  if (set.size === 0) return;

  applyCalendarResyncPatch({
    studentIds: set,
    reason: "관리자가 재동기화를 요청했습니다. 담당 선생님 계정 로그인 시 Meet 일정이 자동으로 다시 생성됩니다.",
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

// upsertSession은 이미 위에서 정의됨 (상단부 consolidated version 사용)

// ✅ 아래 함수들을 lib/storage/sessions.ts에 추가하세요.
// (기존 KEY / loadSessions / upsertSession 스타일을 그대로 따릅니다.)
export function removeSessionsByStudentId(studentId: string): Session[] {
  const list = loadSessions().filter((s) => s.studentId !== studentId);
  saveSessions(list, { snapshotMode: "replace", serverRequired: true });
  return list;
}

export function removeSessionsByStudentIds(studentIds: string[]): Session[] {
  const set = new Set(studentIds);
  const list = loadSessions().filter((s) => !set.has(s.studentId));
  saveSessions(list, { snapshotMode: "replace", serverRequired: true });
  return list;
}

export function removeSession(sessionId: string): Session[] {
  const list = loadSessions().filter((x) => x.id !== sessionId);
  saveSessions(list, { snapshotMode: "replace", serverRequired: true });
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
  void syncSharedSnapshot([], "replace", false).catch((err) => {
    console.error("공유 스냅샷 동기화 실패(sessions):", err);
  });
}
