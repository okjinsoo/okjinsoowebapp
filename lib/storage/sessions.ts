// lib/storage/sessions.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { pushSharedSnapshot, readLocalStudents, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import {
  rebuildTeacherGoogleCalendar,
  scheduleGoogleCalendarSync,
  syncStudentGoogleCalendarMirror,
} from "@/lib/integrations/googleCalendarSync";
import { safeParseJson } from "@/lib/storage/safeParse";
import { loadLatestCoreSnapshotBaseline, mergeById } from "@/lib/storage/safeSnapshotMerge";
import type { Session } from "@/lib/types/index";

const KEY = "tutorweb_sessions_v1";

type SaveSessionsOptions = {
  suppressCalendarSync?: boolean;
  skipSharedSnapshot?: boolean;
  snapshotMode?: "merge" | "replace";
};

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  return safeParseJson<Session[]>(browserStorage.getItem(KEY), []);
}

function replaceSessionsLocal(list: Session[]): boolean {
  if (typeof window === "undefined") return false;
  const nextRaw = JSON.stringify(list);
  if (browserStorage.getItem(KEY) === nextRaw) return false;
  browserStorage.setItem(KEY, nextRaw);
  window.dispatchEvent(new CustomEvent("tutorweb:sessionsUpdated"));
  return true;
}


function syncSharedSnapshot(nextSessions: Session[], mode: "merge" | "replace"): void {
  void (async () => {
    const baseline = await loadLatestCoreSnapshotBaseline();
    const mergedSessions = mode === "replace"
      ? nextSessions
      : mergeById(baseline.sessions, nextSessions);

    await pushSharedSnapshot({
      teachers: baseline.teachers.length > 0 ? baseline.teachers : readLocalTeachers(),
      students: baseline.students.length > 0 ? baseline.students : readLocalStudents(),
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
  return loadSessions()
    .filter((x) => x.studentId === studentId)
    .sort((a, b) => a.index - b.index);
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
 * 학생 성취도 items 전체 로드 (1..planCount)
 * - 읽기 전용
 * - JSON 파싱 실패/손상 데이터는 해당 회차를 건너뜀
 */
export function loadSessionItemsMap(
  token: string,
  planCount: number
): Record<number, SessionItem[]> {
  if (typeof window === "undefined") return {};

  const map: Record<number, SessionItem[]> = {};
  for (let i = 1; i <= planCount; i++) {
    try {
      const raw = browserStorage.getItem(itemsKey(token, i));
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) map[i] = parsed as SessionItem[];
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
