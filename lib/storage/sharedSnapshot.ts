"use client";

import {
  AUTH_STORAGE_KEY,
  getSupabaseConfig,
  getValidAccessToken,
} from "@/lib/auth/supabaseAuth";
import { browserStorage } from "@/lib/storage/browserStorage";
import type { Session, Student, Teacher } from "@/lib/types/index";

const SNAPSHOT_KEY = "main";
const TEACHERS_KEY = "tutorweb_teachers_v1";
const STUDENTS_KEY = "tutorweb_students_v1";
const SESSIONS_KEY = "tutorweb_sessions_v1";
const CONSULTATIONS_KEY = "tutorweb_consultations_v1";
const META_MAP_PREFIX = "tutorweb_metaMap_v1:";
const STUDENTS_EVENT = "tutorweb:studentsUpdated";
const TEACHERS_EVENT = "tutorweb:teachersUpdated";
const SESSIONS_EVENT = "tutorweb:sessionsUpdated";
const PULL_COOLDOWN_MS = 5000;
const SHARED_EXACT_KEYS = new Set([CONSULTATIONS_KEY]);
const SHARED_PREFIXES = [META_MAP_PREFIX];

type SnapshotRow = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  state_kv?: Record<string, unknown> | null;
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

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function shouldPersistKey(key: string): boolean {
  if (!key) return false;
  if (key === AUTH_STORAGE_KEY) return false;
  if (SHARED_EXACT_KEYS.has(key)) return true;
  return SHARED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function toStateKv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!shouldPersistKey(key)) continue;
    if (typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
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

async function getHeaders(args?: { json?: boolean }): Promise<Record<string, string> | null> {
  const cfg = getSupabaseConfig();
  const accessToken = await getValidAccessToken();
  if (!cfg || !accessToken) return null;

  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${accessToken}`,
  };
  if (args?.json) headers["Content-Type"] = "application/json";
  return headers;
}

export function readLocalTeachers(): Teacher[] {
  if (typeof window === "undefined") return [];
  return safeParse<Teacher[]>(browserStorage.getItem(TEACHERS_KEY), []);
}

export function readLocalStudents(): Student[] {
  if (typeof window === "undefined") return [];
  return safeParse<Student[]>(browserStorage.getItem(STUDENTS_KEY), []);
}

export function readLocalSessions(): Session[] {
  if (typeof window === "undefined") return [];
  return safeParse<Session[]>(browserStorage.getItem(SESSIONS_KEY), []);
}

function dispatchLocalSnapshotUpdated(args?: { includeSessions?: boolean }) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEACHERS_EVENT));
  window.dispatchEvent(new CustomEvent(STUDENTS_EVENT));
  if (args?.includeSessions) {
    window.dispatchEvent(new CustomEvent(SESSIONS_EVENT));
  }
}

function applyStateKv(stateKv: Record<string, string> | null | undefined): {
  changed: boolean;
  hadConsultations: boolean;
  hadMetaMap: boolean;
} {
  if (typeof window === "undefined" || !stateKv) {
    return { changed: false, hadConsultations: false, hadMetaMap: false };
  }

  let changed = false;
  let hadConsultations = false;
  let hadMetaMap = false;

  for (const [key, value] of Object.entries(stateKv)) {
    if (!shouldPersistKey(key)) continue;
    if (browserStorage.getItem(key) === value) continue;
    browserStorage.setItem(key, value);
    changed = true;
    if (key === CONSULTATIONS_KEY) hadConsultations = true;
    if (key.startsWith(META_MAP_PREFIX)) hadMetaMap = true;
  }

  return { changed, hadConsultations, hadMetaMap };
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
    window.dispatchEvent(new CustomEvent("tutorweb:consultationsUpdated"));
  }
  if (stateResult.hadMetaMap) {
    window.dispatchEvent(new CustomEvent("tutorweb:metaMapUpdated"));
  }
}

function isMissingColumnError(detail: string, column: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes(column.toLowerCase()) &&
    (lower.includes("column") || lower.includes("schema cache") || lower.includes("42703"))
  );
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

  const res = await fetch(requestUrl.toString(), {
    method: "GET",
    headers: args.headers,
  });

  if (res.ok) {
    return { ok: true, rows: (await res.json()) as SnapshotRow[] };
  }

  return {
    ok: false,
    status: res.status,
    text: await res.text(),
  };
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

export async function pushSharedSnapshot(args?: {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  stateKv?: Record<string, string>;
}): Promise<PushSharedSnapshotResult> {
  const cfg = getSupabaseConfig();
  if (!cfg) return { sessionsSynced: false, stateKvSynced: false };

  const headers = await getHeaders({ json: true });
  if (!headers) return { sessionsSynced: false, stateKvSynced: false };

  const teachers = args?.teachers ?? readLocalTeachers();
  const students = args?.students ?? readLocalStudents();
  const sessions = args?.sessions ?? readLocalSessions();
  const hasStateKvArg = Object.prototype.hasOwnProperty.call(args ?? {}, "stateKv");
  let stateKv: Record<string, string> | undefined;

  if (hasStateKvArg) {
    const readHeaders = await getHeaders();
    if (!readHeaders) return { sessionsSynced: false, stateKvSynced: false };

    const snapshotUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
    const remoteStateKv = await fetchRemoteStateKv({
      url: snapshotUrl,
      headers: readHeaders,
    });
    const localStateKv = toStateKv(args?.stateKv ?? {});
    stateKv = {
      ...remoteStateKv,
      ...localStateKv,
    };
  }

  const snapshotUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  const upsertUrl = new URL(snapshotUrl.toString());
  upsertUrl.searchParams.set("on_conflict", "id");

  const fullPayload: {
    id: string;
    teachers: Teacher[];
    students: Student[];
    sessions: Session[];
    state_kv?: Record<string, string>;
  } = {
    id: SNAPSHOT_KEY,
    teachers,
    students,
    sessions,
  };
  if (stateKv) {
    fullPayload.state_kv = stateKv;
  }

  const fullRes = await fetch(upsertUrl.toString(), {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([fullPayload]),
  });

  if (fullRes.ok) return { sessionsSynced: true, stateKvSynced: true };

  const text = await fullRes.text();
  const sessionsMissing = isMissingColumnError(text, "sessions");
  const stateKvMissing =
    hasStateKvArg && isMissingColumnError(text, "state_kv");

  if (!sessionsMissing && !stateKvMissing) {
    throw new Error(`snapshot upsert failed: ${fullRes.status} ${text}`);
  }

  const fallbackPayload: {
    id: string;
    teachers: Teacher[];
    students: Student[];
    sessions?: Session[];
    state_kv?: Record<string, string>;
  } = {
    id: SNAPSHOT_KEY,
    teachers,
    students,
  };
  if (!sessionsMissing) fallbackPayload.sessions = sessions;
  if (hasStateKvArg && !stateKvMissing && stateKv) {
    fallbackPayload.state_kv = stateKv;
  }

  const fallbackRes = await fetch(upsertUrl.toString(), {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([fallbackPayload]),
  });

  if (!fallbackRes.ok) {
    const fallbackText = await fallbackRes.text();
    throw new Error(
      `snapshot upsert failed (fallback): ${fallbackRes.status} ${fallbackText}`
    );
  }

  return {
    sessionsSynced: !sessionsMissing,
    stateKvSynced: !hasStateKvArg || !stateKvMissing,
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
