"use client";

import {
  AUTH_STORAGE_KEY,
  forceRefreshAuthSession,
  getSupabaseConfig,
  getValidAccessToken,
} from "@/lib/auth/supabaseAuth";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { browserStorage } from "@/lib/storage/browserStorage";
import { safeParseJson } from "@/lib/storage/safeParse";
import {
  isSharedStateKvKey,
  SHARED_CONSULTATIONS_KEY,
  SHARED_LECTURE_TREE_KEY,
  SHARED_META_MAP_PREFIX,
} from "@/lib/storage/sharedStateKeys";
import type { Session, Student, Teacher } from "@/lib/types/index";

const SNAPSHOT_KEY = "main";
const TEACHERS_KEY = "tutorweb_teachers_v1";
const STUDENTS_KEY = "tutorweb_students_v1";
const SESSIONS_KEY = "tutorweb_sessions_v1";
const PULL_COOLDOWN_MS = 2000; // 5초에서 2초로 단축하여 실시간 동기화 반응성 향상

type SnapshotRow = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  state_kv?: Record<string, unknown> | null;
};

type InternalSnapshotResponse = {
  ok?: boolean;
  snapshot?: {
    teachers?: Teacher[];
    students?: Student[];
    sessions?: Session[];
    stateKv?: Record<string, string> | null;
  };
  value?: string | null;
  sessionsSynced?: boolean;
  stateKvSynced?: boolean;
};

type FetchRowsResult =
  | { ok: true; rows: SnapshotRow[] }
  | { ok: false; status: number; text: string };

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

async function getHeaders(args?: { json?: boolean; forceRefresh?: boolean }): Promise<Record<string, string> | null> {
  const cfg = getSupabaseConfig();
  const accessToken = args?.forceRefresh
    ? (await forceRefreshAuthSession())?.accessToken ?? null
    : await getValidAccessToken();
  if (!cfg || !accessToken) return null;

  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  if (args?.json) headers["Content-Type"] = "application/json";
  return headers;
}

function buildInternalSnapshotUrl(stateKey?: string): string {
  if (!stateKey) return "/api/snapshot";
  const params = new URLSearchParams({ stateKey });
  return `/api/snapshot?${params.toString()}`;
}

async function fetchInternalSnapshot(args?: {
  stateKey?: string;
  body?: {
    teachers?: Teacher[];
    students?: Student[];
    sessions?: Session[];
    stateKv?: Record<string, string>;
    dropStateKeys?: string[];
  };
}): Promise<InternalSnapshotResponse | null> {
  if (typeof window === "undefined") return null;

  try {
    const res = await fetch(buildInternalSnapshotUrl(args?.stateKey), {
      method: args?.body ? "POST" : "GET",
      headers: args?.body ? { "Content-Type": "application/json" } : undefined,
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

function dispatchLocalSnapshotUpdated(args?: { includeSessions?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.teachersUpdated));
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.studentsUpdated));
  if (args?.includeSessions) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.sessionsUpdated));
  }
}

function applyStateKv(stateKv: Record<string, string> | null | undefined): {
  changed: boolean;
  hadConsultations: boolean;
  hadMetaMap: boolean;
  hadLectureTree: boolean;
} {
  if (typeof window === "undefined" || !stateKv) {
    return {
      changed: false,
      hadConsultations: false,
      hadMetaMap: false,
      hadLectureTree: false,
    };
  }

  let changed = false;
  let hadConsultations = false;
  let hadMetaMap = false;
  let hadLectureTree = false;

  for (const [key, value] of Object.entries(stateKv)) {
    if (!shouldPersistKey(key)) continue;
    const current = browserStorage.getItem(key);
    if (current === value) continue;

    if (key === SHARED_LECTURE_TREE_KEY) {
      const currentMeta = lectureTreeMeta(current);
      const incomingMeta = lectureTreeMeta(value);

      // 로컬이 비어 있고 원격이 비어있지 않으면 원격 우선
      if (currentMeta.leafCount === 0 && incomingMeta.leafCount > 0) {
        // pass
      } else if (currentMeta.leafCount > 0 && incomingMeta.leafCount === 0) {
        // 원격이 비어있고 로컬이 비어있지 않으면 로컬 유지
        continue;
      } else {
        const currentMs = currentMeta.updatedAtMs;
        const incomingMs = incomingMeta.updatedAtMs;
        // 로컬이 더 최신이면 원격의 오래된 값을 덮어쓰지 않음
        if (currentMs !== null && incomingMs !== null && currentMs > incomingMs) {
          continue;
        }
      }
    }

    browserStorage.setItem(key, value);
    changed = true;
    if (key === SHARED_CONSULTATIONS_KEY) hadConsultations = true;
    if (key === SHARED_LECTURE_TREE_KEY) hadLectureTree = true;
    if (key.startsWith(SHARED_META_MAP_PREFIX)) hadMetaMap = true;
  }

  return { changed, hadConsultations, hadMetaMap, hadLectureTree };
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
  if (stateResult.hadConsultations) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.consultationsUpdated));
  }
  if (stateResult.hadLectureTree) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
  }
  if (stateResult.hadMetaMap) {
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated));
  }
}

function isMissingColumnError(detail: string, column: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes(column.toLowerCase()) &&
    (lower.includes("column") || lower.includes("schema cache") || lower.includes("42703"))
  );
}

function isJwtAuthError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return lower.includes("jwt expired") || lower.includes("invalid jwt") || lower.includes("jwt");
}

function hasLocalSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return (
    browserStorage.getItem(TEACHERS_KEY) !== null &&
    browserStorage.getItem(STUDENTS_KEY) !== null
  );
}

async function fetchSnapshotRows(args: {
  url: URL;
  headers: Record<string, string>;
  select: string;
}): Promise<FetchRowsResult> {
  const requestUrl = new URL(args.url.toString());
  requestUrl.searchParams.set("select", args.select);
  requestUrl.searchParams.set("id", `eq.${SNAPSHOT_KEY}`);
  requestUrl.searchParams.set("limit", "1");

  const execute = async (headers: Record<string, string>): Promise<FetchRowsResult> => {
    const res = await fetch(requestUrl.toString(), {
      method: "GET",
      headers,
    });

    if (res.ok) {
      return { ok: true, rows: (await res.json()) as SnapshotRow[] };
    }

    return {
      ok: false,
      status: res.status,
      text: await res.text(),
    };
  };

  let result = await execute(args.headers);
  if (!result.ok && result.status === 401 && isJwtAuthError(result.text)) {
    const retryHeaders = await getHeaders({ forceRefresh: true });
    if (retryHeaders) {
      result = await execute(retryHeaders);
    }
  }
  return result;
}

async function postSnapshotUpsertWithRetry(args: {
  url: URL;
  headers: Record<string, string>;
  payload: unknown;
}): Promise<{ ok: boolean; status: number; text: string }> {
  const body = JSON.stringify(args.payload);

  const execute = async (headers: Record<string, string>) => {
    const res = await fetch(args.url.toString(), {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates",
      },
      body,
    });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        text: "",
      };
    }
    return {
      ok: false,
      status: res.status,
      text: await res.text(),
    };
  };

  let result = await execute(args.headers);
  if (!result.ok && result.status === 401 && isJwtAuthError(result.text)) {
    const retryHeaders = await getHeaders({ json: true, forceRefresh: true });
    if (retryHeaders) {
      result = await execute(retryHeaders);
    }
  }
  return result;
}

async function fetchRemoteStateKv(args: {
  url: URL;
  headers: Record<string, string>;
}): Promise<Record<string, string>> {
  const result = await fetchSnapshotRows({
    url: args.url,
    headers: args.headers,
    select: "state_kv",
  });
  if (!result.ok) {
    if (isMissingColumnError(result.text, "state_kv")) {
      return {};
    }
    throw new Error(`snapshot fetch failed(state_kv): ${result.status} ${result.text}`);
  }
  const row = result.rows[0];
  return toStateKv(row?.state_kv);
}

export async function readRemoteSharedStateKvValue(key: string): Promise<string | null> {
  const internal = await fetchInternalSnapshot({ stateKey: key });
  if (internal && Object.prototype.hasOwnProperty.call(internal, "value")) {
    return typeof internal.value === "string" ? internal.value : null;
  }

  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const headers = await getHeaders();
  if (!headers) return null;

  const snapshotUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  const stateKv = await fetchRemoteStateKv({
    url: snapshotUrl,
    headers,
  });
  return stateKv[key] ?? null;
}

export async function pushSharedSnapshot(args?: {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  stateKv?: Record<string, string>;
  dropStateKeys?: string[];
}): Promise<PushSharedSnapshotResult> {
  const hasTeachersArg = Object.prototype.hasOwnProperty.call(args ?? {}, "teachers");
  const hasStudentsArg = Object.prototype.hasOwnProperty.call(args ?? {}, "students");
  const hasSessionsArg = Object.prototype.hasOwnProperty.call(args ?? {}, "sessions");
  const hasStateKvArg = Object.prototype.hasOwnProperty.call(args ?? {}, "stateKv");
  const hasDropStateKeysArg = Object.prototype.hasOwnProperty.call(args ?? {}, "dropStateKeys");

  // 서버 측에서 데이터를 재구성하기 위해 항상 핵심 컬렉션을 포함하는 것이 안전함
  const includeTeachers = true;
  const includeStudents = true;
  const includeSessions = true;
  const touchesStateKv = hasStateKvArg || hasDropStateKeysArg;

  const teachers = hasTeachersArg ? (args?.teachers ?? []) : readLocalTeachers();
  const students = hasStudentsArg ? (args?.students ?? []) : readLocalStudents();
  const sessions = hasSessionsArg ? (args?.sessions ?? []) : readLocalSessions();
  const stateKvPatch = hasStateKvArg ? toStateKv(args?.stateKv ?? {}) : undefined;

  const internal = await fetchInternalSnapshot({
    body: {
      ...(includeTeachers ? { teachers: teachers ?? [] } : {}),
      ...(includeStudents ? { students: students ?? [] } : {}),
      ...(includeSessions ? { sessions: sessions ?? [] } : {}),
      ...(hasStateKvArg ? { stateKv: stateKvPatch ?? {} } : {}),
      ...(hasDropStateKeysArg ? { dropStateKeys: args?.dropStateKeys ?? [] } : {}),
    },
  });
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

  const cfg = getSupabaseConfig();
  if (!cfg) {
    return {
      sessionsSynced: !includeSessions,
      stateKvSynced: !touchesStateKv,
    };
  }

  const headers = await getHeaders({ json: true });
  if (!headers) {
    return {
      sessionsSynced: !includeSessions,
      stateKvSynced: !touchesStateKv,
    };
  }
  let stateKv: Record<string, string> | undefined;

  if (touchesStateKv) {
    const readHeaders = await getHeaders();
    if (!readHeaders) {
      return {
        sessionsSynced: !includeSessions,
        stateKvSynced: false,
      };
    }

    const snapshotUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
    const remoteStateKv = await fetchRemoteStateKv({
      url: snapshotUrl,
      headers: readHeaders,
    });
    stateKv = {
      ...remoteStateKv,
      ...(stateKvPatch ?? {}),
    };
    for (const key of args?.dropStateKeys ?? []) {
      if (!shouldPersistKey(key)) continue;
      delete stateKv[key];
    }
  }

  const snapshotUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  const upsertUrl = new URL(snapshotUrl.toString());
  upsertUrl.searchParams.set("on_conflict", "id");

  const fullPayload: {
    id: string;
    teachers?: Teacher[];
    students?: Student[];
    sessions?: Session[];
    state_kv?: Record<string, string>;
  } = { id: SNAPSHOT_KEY };
  if (includeTeachers) fullPayload.teachers = teachers ?? [];
  if (includeStudents) fullPayload.students = students ?? [];
  if (includeSessions) fullPayload.sessions = sessions ?? [];
  if (touchesStateKv && stateKv) {
    fullPayload.state_kv = stateKv;
  }

  const fullResult = await postSnapshotUpsertWithRetry({
    url: upsertUrl,
    headers,
    payload: [fullPayload],
  });

  if (fullResult.ok) {
    return {
      sessionsSynced: true,
      stateKvSynced: true,
    };
  }

  const text = fullResult.text;
  const sessionsMissing = includeSessions && isMissingColumnError(text, "sessions");
  const stateKvMissing = touchesStateKv && isMissingColumnError(text, "state_kv");

  if (!sessionsMissing && !stateKvMissing) {
    throw new Error(`snapshot upsert failed: ${fullResult.status} ${text}`);
  }

  const fallbackPayload: {
    id: string;
    teachers?: Teacher[];
    students?: Student[];
    sessions?: Session[];
    state_kv?: Record<string, string>;
  } = { id: SNAPSHOT_KEY };
  if (includeTeachers) fallbackPayload.teachers = teachers ?? [];
  if (includeStudents) fallbackPayload.students = students ?? [];
  if (includeSessions && !sessionsMissing) fallbackPayload.sessions = sessions ?? [];
  if (touchesStateKv && !stateKvMissing) fallbackPayload.state_kv = stateKv ?? {};

  const fallbackResult = await postSnapshotUpsertWithRetry({
    url: upsertUrl,
    headers,
    payload: [fallbackPayload],
  });

  if (!fallbackResult.ok) {
    const fallbackText = fallbackResult.text;
    throw new Error(
      `snapshot upsert failed (fallback): ${fallbackResult.status} ${fallbackText}`
    );
  }

  return {
    sessionsSynced: !includeSessions || !sessionsMissing,
    stateKvSynced: !touchesStateKv || !stateKvMissing,
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

      applyLocalSnapshot({
        teachers,
        students,
        sessions,
        stateKv,
      });
      lastPullSnapshotAt = Date.now();
      return { teachers, students, sessions };
    }

    const cfg = getSupabaseConfig();
    if (!cfg) return null;

    const headers = await getHeaders();
    if (!headers) return null;

    const baseUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
    const selectFields = ["teachers", "students", "sessions", "state_kv"];
    let sessionsMissing = false;
    let stateKvMissing = false;
    let rows: SnapshotRow[] | null = null;

    while (selectFields.length >= 2) {
      const result = await fetchSnapshotRows({
        url: baseUrl,
        headers,
        select: selectFields.join(","),
      });
      if (result.ok) {
        rows = result.rows;
        break;
      }

      let changed = false;
      if (selectFields.includes("sessions") && isMissingColumnError(result.text, "sessions")) {
        sessionsMissing = true;
        selectFields.splice(selectFields.indexOf("sessions"), 1);
        changed = true;
      }
      if (selectFields.includes("state_kv") && isMissingColumnError(result.text, "state_kv")) {
        stateKvMissing = true;
        selectFields.splice(selectFields.indexOf("state_kv"), 1);
        changed = true;
      }
      if (changed) continue;

      throw new Error(`snapshot fetch failed: ${result.status} ${result.text}`);
    }

    if (!rows) return null;
    const row = rows[0];
    if (!row) return null;

    const teachers = Array.isArray(row.teachers) ? row.teachers : [];
    const students = Array.isArray(row.students) ? row.students : [];
    const sessions =
      !sessionsMissing && Array.isArray(row.sessions)
        ? row.sessions
        : readLocalSessions();
    const stateKv = !stateKvMissing ? toStateKv(row.state_kv) : null;

    applyLocalSnapshot({
      teachers,
      students,
      sessions: sessionsMissing ? undefined : sessions,
      stateKv,
    });
    lastPullSnapshotAt = Date.now();
    return { teachers, students, sessions };
  })();

  try {
    return await pullSnapshotInFlight;
  } finally {
    pullSnapshotInFlight = null;
  }
}
