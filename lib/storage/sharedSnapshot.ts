"use client";

import {
  AUTH_STORAGE_KEY,
  loadAuthSession,
} from "@/lib/auth/supabaseAuth";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { browserStorage } from "@/lib/storage/browserStorage";
import { safeParseJson } from "@/lib/storage/safeParse";
import {
  isSessionProgressStateKey,
  isSharedStateKvKey,
  SHARED_LECTURE_TREE_KEY,
  SHARED_META_MAP_PREFIX,
} from "@/lib/storage/sharedStateKeys";
import type { Session, Student, Teacher } from "@/lib/types/index";

export const SNAPSHOT_KEY = "main";
export const TEACHERS_KEY = "tutorweb_teachers_v1";
export const STUDENTS_KEY = "tutorweb_students_v1";
export const SESSIONS_KEY = "tutorweb_sessions_v1";
const PULL_COOLDOWN_MS = 2000;
const DIGEST_STORAGE_KEY = "tutorweb_snapshot_digest_v1";

type InternalSnapshotResponse = {
  ok?: boolean;
  snapshot?: {
    teachers?: Teacher[];
    students?: Student[];
    sessions?: Session[];
    stateKv?: Record<string, string> | null;
  };
  digest?: string;
  changed?: boolean;
  value?: string | null;
  sessionsSynced?: boolean;
  stateKvSynced?: boolean;
};

type InternalSnapshotBody = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  studentsMergeMode?: "replace" | "merge";
  sessionsMergeMode?: "replace" | "merge";
  stateKv?: Record<string, string>;
  dropStateKeys?: string[];
};

export type PushSharedSnapshotResult = {
  sessionsSynced: boolean;
  stateKvSynced: boolean;
};

let lastPullSnapshotAt = 0;
let pullSnapshotInFlight: Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
} | null> | null = null;

export function isLocalOnlySnapshotMode(): boolean {
  return process.env.NEXT_PUBLIC_TUTORWEB_LOCAL_ONLY === "1";
}

function shouldPersistKey(key: string): boolean {
  if (!key) return false;
  if (key === AUTH_STORAGE_KEY) return false;
  return isSharedStateKvKey(key);
}

function normalizeStateKvValue(key: string, value: unknown): string | null {
  if (typeof value === "string") return value;

  // 과거/수동 SQL 입력에서 객체로 저장된 강의 트리를 문자열로 보정
  if (key === SHARED_LECTURE_TREE_KEY && value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  return null;
}

function toStateKv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!shouldPersistKey(key)) continue;
    const normalized = normalizeStateKvValue(key, value);
    if (typeof normalized !== "string") continue;
    out[key] = normalized;
  }
  return out;
}

function lectureTreeMeta(raw: string | null): { updatedAtMs: number | null; leafCount: number } {
  if (typeof raw !== "string" || !raw.trim()) {
    return { updatedAtMs: null, leafCount: 0 };
  }
  try {
    const parsed = JSON.parse(raw) as { updatedAt?: unknown; root?: unknown };
    const updatedAt = typeof parsed?.updatedAt === "string" ? parsed.updatedAt : "";
    const ms = updatedAt ? Date.parse(updatedAt) : NaN;
    const updatedAtMs = Number.isFinite(ms) ? ms : null;

    const countLeaves = (node: unknown): number => {
      if (!node || typeof node !== "object") return 0;
      const rec = node as Record<string, unknown>;
      if (rec.type === "leaf") return 1;
      if (rec.type !== "folder") return 0;
      const children = Array.isArray(rec.children) ? rec.children : [];
      let total = 0;
      for (const child of children) total += countLeaves(child);
      return total;
    };

    const leafCount = countLeaves(parsed.root);
    return { updatedAtMs, leafCount };
  } catch {
    return { updatedAtMs: null, leafCount: 0 };
  }
}

function readLocalStateKv(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < browserStorage.length; i += 1) {
    const key = browserStorage.key(i);
    if (!key || !shouldPersistKey(key)) continue;
    const value = browserStorage.getItem(key);
    if (value === null) continue;
    out[key] = value;
  }
  return out;
}

export function readLocalSharedStateKv(): Record<string, string> {
  return readLocalStateKv();
}

function buildInternalSnapshotUrl(args?: { stateKey?: string; digest?: string }): string {
  const params = new URLSearchParams();
  if (args?.stateKey) params.set("stateKey", args.stateKey);
  if (args?.digest) params.set("digest", args.digest);
  const qs = params.toString();
  return qs ? `/api/snapshot?${qs}` : "/api/snapshot";
}

async function fetchInternalSnapshot(args?: {
  stateKey?: string;
  body?: InternalSnapshotBody;
}): Promise<InternalSnapshotResponse | null> {
  if (typeof window === "undefined") return null;

  try {
    const digest = !args?.stateKey && !args?.body ? (browserStorage.getItem(DIGEST_STORAGE_KEY) ?? undefined) : undefined;
    const accessToken = loadAuthSession()?.accessToken?.trim() ?? "";
    const headers: Record<string, string> = {};
    if (args?.body) headers["Content-Type"] = "application/json";
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(buildInternalSnapshotUrl({ stateKey: args?.stateKey, digest }), {
      method: args?.body ? "POST" : "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: args?.body ? JSON.stringify(args.body) : undefined,
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    return (await res.json()) as InternalSnapshotResponse;
  } catch {
    return null;
  }
}

export function readLocalTeachers(): Teacher[] {
  if (typeof window === "undefined") return [];
  return safeParseJson<Teacher[]>(browserStorage.getItem(TEACHERS_KEY), []);
}

export function readLocalStudents(): Student[] {
  if (typeof window === "undefined") return [];
  return safeParseJson<Student[]>(browserStorage.getItem(STUDENTS_KEY), []);
}

export function readLocalSessions(): Session[] {
  if (typeof window === "undefined") return [];
  return safeParseJson<Session[]>(browserStorage.getItem(SESSIONS_KEY), []);
}

export function dispatchLocalSnapshotUpdated(args?: { includeSessions?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.teachersUpdated));
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.studentsUpdated));
  if (args?.includeSessions) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.sessionsUpdated));
  }
}

export function applyStateKv(stateKv: Record<string, string> | null | undefined): {
  changed: boolean;
  hadMetaMap: boolean;
  hadLectureTree: boolean;
  hadSessionProgress: boolean;
} {
  if (typeof window === "undefined" || !stateKv) {
    return {
      changed: false,
      hadMetaMap: false,
      hadLectureTree: false,
      hadSessionProgress: false,
    };
  }

  let changed = false;
  let hadMetaMap = false;
  let hadLectureTree = false;
  let hadSessionProgress = false;

  for (const [key, value] of Object.entries(stateKv)) {
    if (!shouldPersistKey(key)) continue;
    const current = browserStorage.getItem(key);
    if (current === value) continue;

    if (key === SHARED_LECTURE_TREE_KEY) {
      const currentMeta = lectureTreeMeta(current);
      const incomingMeta = lectureTreeMeta(value);

      if (currentMeta.leafCount === 0 && incomingMeta.leafCount > 0) {
        // pass
      } else if (currentMeta.leafCount > 0 && incomingMeta.leafCount === 0) {
        continue;
      } else {
        const currentMs = currentMeta.updatedAtMs;
        const incomingMs = incomingMeta.updatedAtMs;
        if (currentMs !== null && incomingMs !== null && currentMs > incomingMs) {
          continue;
        }
      }
    }

    // browserStorage.setItem 대신 setItemSilent를 써서 SharedSnapshotAgent의
    // onStorageChanged(원격 재전송 루프)가 발동하지 않도록 하되, browserStorage 단기 캐시는 즉시 갱신하도록 처리
    browserStorage.setItemSilent(key, value);
    changed = true;
    if (key === SHARED_LECTURE_TREE_KEY) hadLectureTree = true;
    if (key.startsWith(SHARED_META_MAP_PREFIX)) hadMetaMap = true;
    if (isSessionProgressStateKey(key)) hadSessionProgress = true;
  }

  return { changed, hadMetaMap, hadLectureTree, hadSessionProgress };
}

export function applyStateKvAndNotify(stateKv: Record<string, string> | null | undefined): void {
  if (typeof window === "undefined" || !stateKv) return;
  const stateResult = applyStateKv(stateKv);
  if (stateResult.hadLectureTree) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
  }
  if (stateResult.hadMetaMap) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated));
  }
  if (stateResult.hadSessionProgress) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.sessionProgressUpdated));
  }
}

function applyLocalSnapshot(args: {
  teachers: Teacher[];
  students: Student[];
  sessions?: Session[];
  stateKv?: Record<string, string> | null;
}) {
  if (typeof window === "undefined") return;
  let changed = false;
  let sessionsChanged = false;

  const teachersRaw = JSON.stringify(args.teachers);
  if (browserStorage.getItem(TEACHERS_KEY) !== teachersRaw) {
    browserStorage.setItem(TEACHERS_KEY, teachersRaw);
    changed = true;
  }

  const studentsRaw = JSON.stringify(args.students);
  if (browserStorage.getItem(STUDENTS_KEY) !== studentsRaw) {
    browserStorage.setItem(STUDENTS_KEY, studentsRaw);
    changed = true;
  }

  const includeSessions = Array.isArray(args.sessions);
  if (includeSessions) {
    const sessionsRaw = JSON.stringify(args.sessions ?? []);
    if (browserStorage.getItem(SESSIONS_KEY) !== sessionsRaw) {
      browserStorage.setItem(SESSIONS_KEY, sessionsRaw);
      sessionsChanged = true;
    }
  }

  const stateResult = applyStateKv(args.stateKv);

  if (changed || sessionsChanged) {
    dispatchLocalSnapshotUpdated({ includeSessions: sessionsChanged });
  }
  if (stateResult.hadLectureTree) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
  }
  if (stateResult.hadMetaMap) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated));
  }
  if (stateResult.hadSessionProgress) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.sessionProgressUpdated));
  }
}

function hasLocalSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return (
    browserStorage.getItem(TEACHERS_KEY) !== null &&
    browserStorage.getItem(STUDENTS_KEY) !== null
  );
}

export async function readRemoteSharedStateKvValue(key: string): Promise<string | null> {
  if (isLocalOnlySnapshotMode()) {
    if (typeof window === "undefined") return null;
    return browserStorage.getItem(key);
  }

  const internal = await fetchInternalSnapshot({ stateKey: key });
  if (internal && Object.prototype.hasOwnProperty.call(internal, "value")) {
    return typeof internal.value === "string" ? internal.value : null;
  }

  // [보안 패치: Direct DB Fallback 제거]
  // 서버 API(/api/snapshot)가 권한 검증 및 필터링을 전담하므로 클라이언트 직접 DB 조회를 차단합니다.
  return null;
}

type PushSharedSnapshotArgs = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  studentsMergeMode?: "replace" | "merge";
  sessionsMergeMode?: "replace" | "merge";
  stateKv?: Record<string, unknown>;
  dropStateKeys?: string[];
  forceEmpty?: boolean; // [Safety] 의도적으로 빈 데이터를 보낼 때 사용
  manualBackupId?: string; // [Safety] 수동 백업 트리거용
};

function mergeEntitiesById<T extends { id: string }>(base: T[], patch: T[]): T[] {
  const patchById = new Map<string, T>();
  for (const row of patch) {
    if (!row?.id) continue;
    patchById.set(row.id, row);
  }
  const merged: T[] = [];
  const seen = new Set<string>();
  for (const row of base) {
    if (!row?.id) continue;
    const next = patchById.get(row.id);
    if (next) {
      merged.push(next);
      seen.add(row.id);
    } else {
      merged.push(row);
    }
  }
  for (const row of patch) {
    if (!row?.id || seen.has(row.id)) continue;
    merged.push(row);
    seen.add(row.id);
  }
  return merged;
}

export async function pushSharedSnapshot(args?: PushSharedSnapshotArgs): Promise<PushSharedSnapshotResult> {
  const hasTeachersArg = Object.prototype.hasOwnProperty.call(args ?? {}, "teachers");
  const hasStudentsArg = Object.prototype.hasOwnProperty.call(args ?? {}, "students");
  const hasSessionsArg = Object.prototype.hasOwnProperty.call(args ?? {}, "sessions");
  const hasStateKvArg = Object.prototype.hasOwnProperty.call(args ?? {}, "stateKv");
  const hasDropStateKeysArg = Object.prototype.hasOwnProperty.call(args ?? {}, "dropStateKeys");

  // [Phase 25.1] 강력한 데이터 유실 방지 가드 (Strict Empty Guard)
  // 의도적 비우기(forceEmpty)나 부분 병합(merge)이 아닌데 []를 보내려 하면 즉시 차단한다.
  if (!args?.forceEmpty) {
    if (
      hasStudentsArg &&
      args?.studentsMergeMode !== "merge" &&
      (args?.students?.length ?? 0) === 0 &&
      readLocalStudents().length > 0
    ) {
      console.error("⛔ [Safety Guard] 학생 데이터 유실 위험이 감지되어 업로드를 차단했습니다. (Empty Array Blocked)");
      return { sessionsSynced: false, stateKvSynced: false };
    }
    if (
      hasSessionsArg &&
      args?.sessionsMergeMode !== "merge" &&
      (args?.sessions?.length ?? 0) === 0 &&
      readLocalSessions().length > 0
    ) {
      console.error("⛔ [Safety Guard] 수업 데이터 유실 위험이 감지되어 업로드를 차단했습니다. (Empty Array Blocked)");
      return { sessionsSynced: false, stateKvSynced: false };
    }
  }

  const touchesStateKv = hasStateKvArg || hasDropStateKeysArg;

  const teachers = hasTeachersArg ? (args?.teachers ?? []) : undefined;
  const students = hasStudentsArg ? (args?.students ?? []) : undefined;
  const sessions = hasSessionsArg ? (args?.sessions ?? []) : undefined;
  const stateKvPatch = hasStateKvArg ? toStateKv(args?.stateKv ?? {}) : undefined;

  if (isLocalOnlySnapshotMode()) {
    const localTeachers = hasTeachersArg ? teachers ?? [] : readLocalTeachers();
    const localStudents = hasStudentsArg
      ? args?.studentsMergeMode === "merge"
        ? mergeEntitiesById(readLocalStudents(), students ?? [])
        : (students ?? [])
      : readLocalStudents();
    const localSessions = hasSessionsArg
      ? args?.sessionsMergeMode === "merge"
        ? mergeEntitiesById(readLocalSessions(), sessions ?? [])
        : (sessions ?? [])
      : undefined;
    const localStateKv = readLocalStateKv();
    const droppedStateKeys = Array.from(
      new Set((args?.dropStateKeys ?? []).map((key) => key.trim()).filter((key) => shouldPersistKey(key)))
    );

    if (typeof window !== "undefined") {
      for (const key of droppedStateKeys) {
        localStorage.removeItem(key);
        if (key === SHARED_LECTURE_TREE_KEY) {
          window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
        }
        if (key.startsWith(SHARED_META_MAP_PREFIX)) {
          window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated));
        }
      }
    }

    const mergedStateKv = {
      ...localStateKv,
      ...(stateKvPatch ?? {}),
    };
    for (const key of droppedStateKeys) {
      delete mergedStateKv[key];
    }

    applyLocalSnapshot({
      teachers: localTeachers,
      students: localStudents,
      sessions: localSessions,
      stateKv: touchesStateKv ? mergedStateKv : undefined,
    });

    return {
      sessionsSynced: true,
      stateKvSynced: true,
    };
  }

  const body: InternalSnapshotBody = {};
  if (hasTeachersArg) body.teachers = teachers;
  if (hasStudentsArg) {
    body.students = students;
    if (args?.studentsMergeMode) body.studentsMergeMode = args.studentsMergeMode;
  }
  if (hasSessionsArg) {
    body.sessions = sessions;
    if (args?.sessionsMergeMode) body.sessionsMergeMode = args.sessionsMergeMode;
  }
  if (hasStateKvArg) body.stateKv = stateKvPatch ?? {};
  if (hasDropStateKeysArg) body.dropStateKeys = args?.dropStateKeys ?? [];

  // 아무 데이터도 없으면 전송 중단
  if (Object.keys(body).length === 0) {
    return { sessionsSynced: true, stateKvSynced: true };
  }

  const internal = await fetchInternalSnapshot({ body });
  
  if (
    internal &&
    typeof internal.sessionsSynced === "boolean" &&
    typeof internal.stateKvSynced === "boolean"
  ) {
    return {
      sessionsSynced: internal.sessionsSynced,
      stateKvSynced: internal.stateKvSynced,
    };
  }

  // [보안 패치: Direct DB Upsert Fallback 제거]
  // 서버 문지기(/api/snapshot)가 거절했거나 통신에 실패했을 때 브라우저가 직접 DB를 덮어쓰면
  // 권한 우회 및 동시성 데이터 증발이 발생하므로 안전하게 동기화 실패를 반환합니다.
  return {
    sessionsSynced: false,
    stateKvSynced: false,
  };
}

export async function pullSharedSnapshotAndHydrate(): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
} | null> {
  return pullSharedSnapshotAndHydrateWithOptions();
}

export async function pullSharedSnapshotAndHydrateWithOptions(args?: {
  forceRemote?: boolean;
}): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
} | null> {
  const forceRemote = Boolean(args?.forceRemote);

  if (isLocalOnlySnapshotMode()) {
    lastPullSnapshotAt = Date.now();
    return {
      teachers: readLocalTeachers(),
      students: readLocalStudents(),
      sessions: readLocalSessions(),
    };
  }

  if (!forceRemote && Date.now() - lastPullSnapshotAt < PULL_COOLDOWN_MS && hasLocalSnapshot()) {
    return {
      teachers: readLocalTeachers(),
      students: readLocalStudents(),
      sessions: readLocalSessions(),
    };
  }

  if (pullSnapshotInFlight) return pullSnapshotInFlight;

  pullSnapshotInFlight = (async () => {
    const internal = await fetchInternalSnapshot();
    const internalSnapshot = internal?.snapshot;
    if (internalSnapshot) {
      const teachers = Array.isArray(internalSnapshot.teachers) ? internalSnapshot.teachers : [];
      const students = Array.isArray(internalSnapshot.students) ? internalSnapshot.students : [];
      const sessions = Array.isArray(internalSnapshot.sessions) ? internalSnapshot.sessions : [];
      const stateKv = toStateKv(internalSnapshot.stateKv);

      // 서버에서 가져온 데이터가 비어있더라도 사용자 명령에 따라 그대로 수용
      const serverStudents = Array.isArray(internalSnapshot.students) ? internalSnapshot.students : [];

      applyLocalSnapshot({
        teachers,
        students: serverStudents,
        sessions,
        stateKv,
      });
      lastPullSnapshotAt = Date.now();
      if (internal.digest) {
        browserStorage.setItem(DIGEST_STORAGE_KEY, internal.digest);
      }
      return { teachers, students, sessions };
    }

    if (internal?.ok && internal.changed === false) {
      // 서버에서 바뀐 게 없다고 함 -> 로컬 데이터 그대로 사용
      lastPullSnapshotAt = Date.now();
      return {
        teachers: readLocalTeachers(),
        students: readLocalStudents(),
        sessions: readLocalSessions(),
      };
    }

    // [보안 패치: Direct DB Pull Fallback 제거]
    // 서버 API(/api/snapshot)가 일시적으로 응답하지 않으면 기존 로컬 스냅샷을 안전하게 유지합니다.
    if (hasLocalSnapshot()) {
      return {
        teachers: readLocalTeachers(),
        students: readLocalStudents(),
        sessions: readLocalSessions(),
      };
    }
    return null;
  })();

  try {
    return await pullSnapshotInFlight;
  } finally {
    pullSnapshotInFlight = null;
  }
}
