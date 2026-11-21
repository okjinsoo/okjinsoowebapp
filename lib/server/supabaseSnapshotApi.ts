import "server-only";

import { createHash } from "crypto";
import type { NextRequest } from "next/server";

import {
  getSupabaseAnonConfigFromEnv,
  normalizeEmail,
  resolveAccessTokenFromRequest,
} from "@/lib/security/requestAuth";
import {
  LOCAL_DEV_ADMIN_EMAIL,
  LOCAL_DEV_ADMIN_USER_ID,
  hasLocalDevAdminSession,
} from "@/lib/auth/localDevAuth";
import { fetchSupabaseAuthUserCached, fetchRoleBindingCached } from "@/lib/server/authCache";
import { logSecurityEvent } from "@/lib/security/securityLog";
import { logPerf } from "@/lib/server/performanceLog";
import {
  isSessionProgressStateKey,
  isSharedStateKvKey,
  SHARED_META_MAP_PREFIX,
} from "@/lib/storage/sharedStateKeys";
import { isTeacherAllowedStateKvKey } from "@/lib/server/snapshotFilter";
import type { Session, Student, Teacher } from "@/lib/types/index";
import { computeChangedRowsById, executeDualWriteSync } from "@/lib/server/dualWriteSync";

const SNAPSHOT_KEY = "main";
export function getAdminEmails(): Set<string> {
  const envEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return new Set(["rapah0310@gmail.com", ...envEmails]);
}
const FIXED_ADMIN_EMAILS = getAdminEmails();

type SupabaseConfig = {
  url: string;
  anonKey: string;
  serviceRoleKey: string | null;
};

type SnapshotRow = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  state_kv?: Record<string, unknown> | null;
};

type MissingColumns = {
  sessions: boolean;
  stateKv: boolean;
};

export type ViewerRole = "guest" | "student" | "teacher" | "admin";

export type NormalizedSnapshot = {
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
  stateKv: Record<string, string>;
};

export type ViewerContext = {
  accessToken: string;
  email: string | null;
  userId: string | null;
  role: ViewerRole;
  teacherId: string | null;
  studentId: string | null;
  snapshot: NormalizedSnapshot;
  digest: string;
  isLocalDevAdmin: boolean;
};

export type SnapshotMergeMode = "replace" | "merge";

export type SnapshotPatch = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  studentsMergeMode?: SnapshotMergeMode;
  sessionsMergeMode?: SnapshotMergeMode;
  stateKv?: Record<string, string>;
  dropStateKeys?: string[];
};

/**
 * 부분 병합 모드("merge")에서 기존 배열을 보존하면서 패치 항목만 ID 기준으로 안전 병합합니다.
 * - 관리자/선생님이 동시에 서로 다른 학생을 수정할 때 발생하는 덮어쓰기(Lost Update)를 원천 차단합니다.
 */
export function mergeSnapshotEntitiesById<T extends { id: string }>(
  existing: T[],
  patchItems: T[]
): T[] {
  const patchById = new Map<string, T>();
  for (const item of patchItems) {
    if (!item?.id) continue;
    patchById.set(item.id, item);
  }
  if (patchById.size === 0) return existing;

  const merged: T[] = [];
  const seen = new Set<string>();
  for (const row of existing) {
    if (!row?.id) continue;
    const patched = patchById.get(row.id);
    if (patched) {
      merged.push(patched);
      seen.add(row.id);
    } else {
      merged.push(row);
    }
  }
  for (const item of patchItems) {
    if (!item?.id || seen.has(item.id)) continue;
    merged.push(item);
    seen.add(item.id);
  }
  return merged;
}

/**
 * 선생님이 studentsMergeMode="merge"로 학생을 패치할 때 보안 경계를 강제합니다.
 * - 이미 DB에 존재하는 학생 ID는 반드시 원래부터 본인 담당인 학생만 수정 허용(타 선생님 학생 탈취 차단)
 * - DB에 없는 신규 학생 ID는 teacherId가 본인인 경우만 허용
 */
export function filterTeacherAllowedStudentMergePatch(
  existingStudents: Student[],
  patchStudents: Student[],
  teacherId: string
): Student[] {
  const existingById = new Map<string, Student>();
  for (const s of existingStudents) {
    if (s?.id) existingById.set(s.id, s);
  }
  return patchStudents.filter((patch) => {
    if (!patch?.id) return false;
    const existing = existingById.get(patch.id);
    if (existing) {
      return existing.teacherId === teacherId;
    }
    return patch.teacherId === teacherId;
  });
}

/**
 * 선생님이 sessionsMergeMode="merge"로 세션을 패치할 때 보안 경계를 강제합니다.
 * - 이미 DB에 존재하는 세션 ID는 원래 소속 학생과 패치 대상 학생 모두 본인 담당인 경우만 허용
 * - 신규 세션 ID는 소속 학생이 본인 담당인 경우만 허용
 */
export function filterTeacherAllowedSessionMergePatch(
  existingSessions: Session[],
  patchSessions: Session[],
  myStudentIds: Set<string>
): Session[] {
  const existingById = new Map<string, Session>();
  for (const s of existingSessions) {
    if (s?.id) existingById.set(s.id, s);
  }
  return patchSessions.filter((patch) => {
    if (!patch?.id || !myStudentIds.has(patch.studentId)) return false;
    const existing = existingById.get(patch.id);
    if (existing) {
      return myStudentIds.has(existing.studentId);
    }
    return true;
  });
}

/**
 * [V18 최적화] 데이터의 변경 여부를 짧은 문자열로 요약합니다.
 * 본문 전체를 보내기 전에 이 값을 비교하여 바뀐 게 없으면 전송을 생략합니다.
 */
export function calculateSnapshotDigest(snapshot: NormalizedSnapshot): string {
  const tCount = snapshot.teachers.length;
  const sCount = snapshot.students.length;
  const sessCount = snapshot.sessions.length;
  // [다이어트] 백업 키(mk3:backup:...) 등 UI와 무관한 키를 제외하고 순수 공유 상태 키만 반영
  const kvKeys = Object.keys(snapshot.stateKv).filter(isSharedStateKvKey).sort();
  const kvCount = kvKeys.length;

  // [진도율/메타맵 완벽 감지] 기존 slice(-3) 샘플링은 알파벳 뒤쪽(tutorweb_metaMap_v1:...)에 가려져
  // 앞쪽의 모든 학생 학습 진도율(mk3:...:progressByLeafId) 변경을 감지하지 못하던 문제를 원천 해결합니다.
  const hash = createHash("sha256");
  for (const k of kvKeys) {
    hash.update(k);
    hash.update("\0");
    hash.update(snapshot.stateKv[k] ?? "");
    hash.update("\n");
  }
  const kvHash = hash.digest("base64url").slice(0, 24);

  const sample = JSON.stringify({
    tc: tCount,
    sc: sCount,
    sec: sessCount,
    kc: kvCount,
    kh: kvHash,
    ls: snapshot.sessions[sessCount - 1]?.id ?? "",
  });

  return Buffer.from(sample).toString("base64");
}

function getSupabaseServerConfig(): SupabaseConfig | null {
  const anonCfg = getSupabaseAnonConfigFromEnv();
  if (!anonCfg) return null;
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return {
    ...anonCfg,
    serviceRoleKey: serviceRoleKey || null,
  };
}

function requestIdOf(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-id") ??
    request.headers.get("x-request-id") ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function buildHeaders(args: {
  cfg: SupabaseConfig;
  accessToken: string;
  json?: boolean;
  preferMerge?: boolean;
  useServiceRole?: boolean;
}): Record<string, string> {
  // 서버 내부에서 이미 resolveViewerContext로 사용자 인증/권한을 검증했으므로
  // DB RLS 잠금과 호환되도록 serviceRoleKey가 있으면 기본 활용합니다.
  const useServiceRole = Boolean((args.useServiceRole ?? true) && args.cfg.serviceRoleKey);
  const apikey = useServiceRole ? args.cfg.serviceRoleKey! : args.cfg.anonKey;
  const bearer = useServiceRole ? args.cfg.serviceRoleKey! : args.accessToken;
  const headers: Record<string, string> = {
    apikey,
    Authorization: `Bearer ${bearer}`,
  };
  if (args.json) headers["Content-Type"] = "application/json";
  if (args.preferMerge) headers.Prefer = "resolution=merge-duplicates";
  return headers;
}

function isMissingColumnError(detail: string, column: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes(column.toLowerCase()) &&
    (lower.includes("column") || lower.includes("schema cache") || lower.includes("42703"))
  );
}

function normalizeStateKvValue(key: string, value: unknown): string | null {
  if (typeof value === "string") return value;
  if (key === "mk3:lectureTree" && value && typeof value === "object") {
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
    if (!isSharedStateKvKey(key)) continue;
    const normalized = normalizeStateKvValue(key, value);
    if (typeof normalized !== "string") continue;
    out[key] = normalized;
  }
  return out;
}

async function fetchSnapshotRow(args: {
  cfg: SupabaseConfig;
  accessToken: string;
  select?: string[];
  useServiceRole?: boolean;
}): Promise<{ row: SnapshotRow | null; missing: MissingColumns }> {
  const baseUrl = new URL("/rest/v1/app_state_snapshots", args.cfg.url);
  const selectFields = [...(args.select ?? ["teachers", "students", "sessions", "state_kv"])];
  const missing: MissingColumns = { sessions: false, stateKv: false };

  while (selectFields.length >= 1) {
    const requestUrl = new URL(baseUrl.toString());
    requestUrl.searchParams.set("select", selectFields.join(","));
    requestUrl.searchParams.set("id", `eq.${SNAPSHOT_KEY}`);
    requestUrl.searchParams.set("limit", "1");

    const res = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: buildHeaders({
        cfg: args.cfg,
        accessToken: args.accessToken,
        useServiceRole: args.useServiceRole,
      }),
      cache: "no-store",
    });

    if (res.ok) {
      const rows = (await res.json()) as SnapshotRow[];
      return { row: rows[0] ?? null, missing };
    }

    const text = await res.text();
    let changed = false;
    if (selectFields.includes("sessions") && isMissingColumnError(text, "sessions")) {
      selectFields.splice(selectFields.indexOf("sessions"), 1);
      missing.sessions = true;
      changed = true;
    }
    if (selectFields.includes("state_kv") && isMissingColumnError(text, "state_kv")) {
      selectFields.splice(selectFields.indexOf("state_kv"), 1);
      missing.stateKv = true;
      changed = true;
    }
    if (changed) continue;
    throw new Error(`snapshot fetch failed: ${res.status} ${text}`);
  }

  return { row: null, missing };
}

function normalizeSnapshot(row: SnapshotRow | null, missing: MissingColumns): NormalizedSnapshot {
  return {
    teachers: Array.isArray(row?.teachers) ? row?.teachers : [],
    students: Array.isArray(row?.students) ? row?.students : [],
    sessions: !missing.sessions && Array.isArray(row?.sessions) ? row.sessions : [],
    stateKv: !missing.stateKv ? toStateKv(row?.state_kv) : {},
  };
}

function resolveFallbackRole(email: string, snapshot: NormalizedSnapshot): ViewerRole | null {
  if (!email) return null;
  if (snapshot.teachers.some((teacher) => normalizeEmail(teacher.email) === email)) {
    return "teacher";
  }
  if (snapshot.students.some((student) => normalizeEmail(student.googleEmail) === email)) {
    return "student";
  }
  return null;
}

function resolveTeacherId(email: string, snapshot: NormalizedSnapshot): string | null {
  if (!email) return null;
  const teacher = snapshot.teachers.find((row) => normalizeEmail(row.email) === email);
  return teacher?.id ?? null;
}

function hasDriveFolder(student: Student): boolean {
  return Boolean((student.driveFolderId ?? "").trim());
}

function pickBestStudentByEmail(students: Student[], email: string): Student | null {
  const matched = students.filter((student) => normalizeEmail(student.googleEmail) === email);
  if (matched.length === 0) return null;

  const activeWithLocker = matched.find((student) => student.status === "active" && hasDriveFolder(student));
  if (activeWithLocker) return activeWithLocker;

  const withLocker = matched.find((student) => hasDriveFolder(student));
  if (withLocker) return withLocker;

  const active = matched.find((student) => student.status === "active");
  return active ?? matched[0] ?? null;
}

function resolveStudentId(email: string, snapshot: NormalizedSnapshot): string | null {
  if (!email) return null;
  const student = pickBestStudentByEmail(snapshot.students, email);
  return student?.id ?? null;
}

export type ResolveViewerOptions = {
  includeSessions?: boolean;
  includeStateKv?: boolean;
};

export async function resolveViewerContext(
  request: NextRequest,
  options?: ResolveViewerOptions
): Promise<ViewerContext | null> {
  const startMs = Date.now();
  const requestId = requestIdOf(request);
  const route = `${request.nextUrl.pathname}#resolveViewerContext`;
  const cfg = getSupabaseServerConfig();
  if (!cfg) {
    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 500,
      startMs,
      extra: { result: "supabase_config_missing" },
    });
    return null;
  }

  const selectFields = ["teachers", "students"];
  if (options?.includeSessions ?? true) selectFields.push("sessions");
  if (options?.includeStateKv ?? true) selectFields.push("state_kv");

  if (hasLocalDevAdminSession(request)) {
    if (!cfg.serviceRoleKey) return null;
    const snapshotStartMs = Date.now();
    const snapshotResult = await fetchSnapshotRow({
      cfg,
      accessToken: cfg.serviceRoleKey,
      select: selectFields,
      useServiceRole: true,
    });
    const snapshotMs = Date.now() - snapshotStartMs;
    const snapshot = normalizeSnapshot(snapshotResult.row, snapshotResult.missing);
    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 200,
      startMs,
      extra: {
        result: "ok",
        role: "admin",
        authUserMs: 0,
        snapshotMs,
        roleMs: 0,
        teachers: snapshot.teachers.length,
        students: snapshot.students.length,
        sessions: snapshot.sessions.length,
        stateKvKeys: Object.keys(snapshot.stateKv).length,
      },
    });
    return {
      accessToken: cfg.serviceRoleKey,
      email: LOCAL_DEV_ADMIN_EMAIL,
      userId: LOCAL_DEV_ADMIN_USER_ID,
      role: "admin",
      teacherId: null,
      studentId: null,
      snapshot,
      digest: calculateSnapshotDigest(snapshot),
      isLocalDevAdmin: true,
    };
  }

  const accessToken =
    (await resolveAccessTokenFromRequest(request, {
      allowAuthorizationHeader: true,
      allowLegacyCookieJson: true,
    })) ?? "";
  if (!accessToken) {
    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 401,
      startMs,
      extra: { result: "token_missing" },
    });
    return null;
  }

  const authUserStartMs = Date.now();
  const user = await fetchSupabaseAuthUserCached({ cfg, accessToken });
  const authUserMs = Date.now() - authUserStartMs;
  if (!user) {
    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 401,
      startMs,
      extra: { result: "auth_user_missing", authUserMs },
    });
    return null;
  }

  const normalizedEmail = normalizeEmail(user.email);
  const email = normalizedEmail || null;

  // [Phase 1 최적화] 스냅샷 조회와 역할 조회를 Promise.all로 병렬 실행하여 응답 지연 50% 단축
  const parallelStartMs = Date.now();
  const isAdmin = email ? FIXED_ADMIN_EMAILS.has(email) : false;

  const [snapshotResult, fetchedRole] = await Promise.all([
    fetchSnapshotRow({ cfg, accessToken, select: selectFields }),
    email && !isAdmin
      ? fetchRoleBindingCached({ cfg, accessToken, email }).catch(() => "guest" as ViewerRole)
      : Promise.resolve(isAdmin ? ("admin" as ViewerRole) : ("guest" as ViewerRole)),
  ]);
  const parallelMs = Date.now() - parallelStartMs;

  const snapshot = normalizeSnapshot(snapshotResult.row, snapshotResult.missing);

  let role: ViewerRole = fetchedRole ?? "guest";
  if (role === "guest" && email) {
    role = resolveFallbackRole(email, snapshot) ?? "guest";
  }

  const teacherId = email ? resolveTeacherId(email, snapshot) : null;
  const studentId = email ? resolveStudentId(email, snapshot) : null;
  logPerf({
    event: "done",
    route,
    requestId,
    method: request.method,
    status: 200,
    startMs,
    extra: {
      result: "ok",
      role,
      authUserMs,
      parallelMs,
      teachers: snapshot.teachers.length,
      students: snapshot.students.length,
      sessions: snapshot.sessions.length,
      stateKvKeys: Object.keys(snapshot.stateKv).length,
      hasTeacherId: Boolean(teacherId),
      hasStudentId: Boolean(studentId),
    },
  });

  return {
    accessToken,
    email,
    userId: user.id,
    role,
    teacherId,
    studentId,
    snapshot,
    digest: calculateSnapshotDigest(snapshot), // [V18 추가]
    isLocalDevAdmin: false,
  };
}

export function canReadStudent(viewer: ViewerContext, studentId: string): boolean {
  if (viewer.role === "admin") return true;
  if (viewer.role === "teacher") {
    return viewer.snapshot.students.some(
      (student) => student.id === studentId && student.teacherId === viewer.teacherId
    );
  }
  if (viewer.role === "student") {
    return viewer.studentId === studentId;
  }
  return false;
}

export function filterTeachersForViewer(viewer: ViewerContext): Teacher[] {
  if (viewer.role === "admin") return viewer.snapshot.teachers;
  if (viewer.role === "teacher") {
    return viewer.snapshot.teachers.filter((teacher) => teacher.id === viewer.teacherId);
  }
  if (viewer.role === "student") {
    const student = viewer.snapshot.students.find((row) => row.id === viewer.studentId);
    if (!student?.teacherId) return [];
    return viewer.snapshot.teachers.filter((teacher) => teacher.id === student.teacherId);
  }
  return [];
}

export function filterStudentsForViewer(viewer: ViewerContext): Student[] {
  if (viewer.role === "admin") return viewer.snapshot.students;
  if (viewer.role === "teacher") {
    return viewer.snapshot.students.filter((student) => student.teacherId === viewer.teacherId);
  }
  if (viewer.role === "student") {
    return viewer.snapshot.students.filter((student) => student.id === viewer.studentId);
  }
  return [];
}

export function filterSessionsForStudent(viewer: ViewerContext, studentId: string): Session[] {
  if (!canReadStudent(viewer, studentId)) return [];
  return viewer.snapshot.sessions.filter((session) => session.studentId === studentId);
}

export async function readSnapshotStateValue(request: NextRequest, key: string): Promise<string | null> {
  const viewer = await resolveViewerContext(request);
  if (!viewer) return null;
  if (!isSharedStateKvKey(key)) return null;
  return viewer.snapshot.stateKv[key] ?? null;
}

export function isStudentAllowedStateKvKey(key: string, studentToken: string | null | undefined): boolean {
  const token = (studentToken ?? "").trim();
  if (!token || !key) return false;
  if (key === `${SHARED_META_MAP_PREFIX}${token}`) return true;
  if (key.startsWith(`mk3:${token}:session:`) && isSessionProgressStateKey(key)) {
    return true;
  }
  return false;
}

export async function upsertSnapshotPatch(args: {
  request: NextRequest;
  patch: SnapshotPatch;
}): Promise<{ sessionsSynced: boolean; stateKvSynced: boolean }> {
  const cfg = getSupabaseServerConfig();
  const hasSessionsPatch = Object.prototype.hasOwnProperty.call(args.patch, "sessions");
  const viewer = await resolveViewerContext(args.request, {
    includeSessions: hasSessionsPatch,
    includeStateKv: false,
  });
  if (!cfg || !viewer) {
    throw new Error("unauthorized");
  }
  const requestId = requestIdOf(args.request);
  const route = args.request.nextUrl.pathname;
  const logGuard = (reason: string, extra?: Record<string, unknown>) => {
    logSecurityEvent({
      level: "error",
      message: "Snapshot patch blocked",
      requestId,
      route,
      reason,
      actorEmail: viewer.email,
      extra: {
        role: viewer.role,
        ...(extra ?? {}),
      },
    });
  };

  const hasTeachers = Object.prototype.hasOwnProperty.call(args.patch, "teachers");
  const hasStudents = Object.prototype.hasOwnProperty.call(args.patch, "students");
  const hasSessions = Object.prototype.hasOwnProperty.call(args.patch, "sessions");
  const hasStateKv = Object.prototype.hasOwnProperty.call(args.patch, "stateKv");
  const hasDropStateKeys = Object.prototype.hasOwnProperty.call(args.patch, "dropStateKeys");
  const touchesStateKv = hasStateKv || hasDropStateKeys;

  // [Phase 23 + C-2 보완] 서버 사이드 권한/무결성 검증 (DB 쓰기/RPC 실행 전에 최우선 검증)
  // 0. 미등록 게스트 계정은 어떤 스냅샷 쓰기도 허용하지 않음
  if (viewer.role === "guest") {
    logGuard("UNAUTHORIZED_GUEST_WRITE");
    throw new Error("unauthorized");
  }

  // 1. 관리자만 선생님 정보를 수정할 수 있음
  if (hasTeachers && viewer.role !== "admin") {
    logGuard("UNAUTHORIZED_TEACHER_EDIT");
    throw new Error("unauthorized_teacher_edit");
  }

  // 2. 학생 계정의 제약 사항
  if (viewer.role === "student") {
    const currentStudent = viewer.snapshot.students.find((s) => s.id === viewer.studentId);
    const studentToken = currentStudent?.token?.trim() ?? "";

    // 2-1. 자신의 학생 정보만 수정 가능 (전체 학생 명단 수정 시도 차단)
    if (hasStudents) {
      if (!args.patch.students || args.patch.students.length > 1 || args.patch.students[0]?.id !== viewer.studentId) {
        logGuard("UNAUTHORIZED_STUDENT_DATA_MANIPULATION");
        throw new Error("unauthorized_student_data_manipulation");
      }
      // 2-2. 민감 정보(결제, 횟수 등) 수정 시도 차단
      const patchStudent = args.patch.students[0];
      if (currentStudent && patchStudent) {
        if (
          patchStudent.planCount !== currentStudent.planCount ||
          JSON.stringify(patchStudent.paymentHistory) !== JSON.stringify(currentStudent.paymentHistory)
        ) {
          logGuard("UNAUTHORIZED_FINANCIAL_DATA_MANIPULATION", {
            studentId: patchStudent.id,
          });
          throw new Error("unauthorized_financial_data_manipulation");
        }
      }
    }
    // 2-3. 수업(sessions) 및 선생님 정보 수정 차단
    if (hasSessions || hasTeachers) {
      logGuard("UNAUTHORIZED_SESSION_OR_TEACHER_MANIPULATION", {
        hasSessions,
        hasTeachers,
      });
      throw new Error("unauthorized_session_or_teacher_manipulation");
    }
    // 2-4. 학습 상태(stateKv)는 오직 본인 토큰(mk3:{token}:session:..., tutorweb_metaMap_v1:{token})만 허용하고
    //      타 학생의 학습 상태나 전역 강의 트리(mk3:lectureTree 등) 수정은 철통 차단
    if (touchesStateKv) {
      const stateKvKeys = Object.keys(args.patch.stateKv ?? {});
      const dropKeys = (args.patch.dropStateKeys ?? []).map((k) => k.trim()).filter(Boolean);
      const allTouchedKeys = [...stateKvKeys, ...dropKeys];
      const hasForbiddenKey =
        !studentToken || allTouchedKeys.some((k) => !isStudentAllowedStateKvKey(k, studentToken));

      if (hasForbiddenKey) {
        logGuard("UNAUTHORIZED_METADATA_MANIPULATION", {
          studentId: viewer.studentId,
          touchedKeysCount: allTouchedKeys.length,
        });
        throw new Error("unauthorized_metadata_manipulation");
      }
    }
  }

  const studentsMergeMode: SnapshotMergeMode =
    args.patch.studentsMergeMode === "merge" ? "merge" : "replace";
  const sessionsMergeMode: SnapshotMergeMode =
    args.patch.sessionsMergeMode === "merge" ? "merge" : "replace";

  if (hasStudents && viewer.role !== "student" && studentsMergeMode !== "merge") {
    const patchStudents = args.patch.students ?? [];
    const currentStudents = viewer.snapshot.students;
    if (currentStudents.length > 5 && patchStudents.length < currentStudents.length * 0.5) {
      logGuard("MASS_DELETION_BLOCKED", {
        beforeCount: currentStudents.length,
        afterCount: patchStudents.length,
      });
      throw new Error("server_blocked_mass_deletion");
    }
  }

  let mergedStateKv: Record<string, unknown> | undefined;
  let stateKvUpdatedAtomically = false;

  if (touchesStateKv) {
    // [선택지 B 보안] 선생님이 다른 선생님 담당 학생의 학습 진도/출결 키를 덮어쓰지 않도록 필터링
    const rawPatchKv = toStateKv(args.patch.stateKv ?? {});
    const rawDropKeys = Array.from(
      new Set((args.patch.dropStateKeys ?? []).map((key) => key.trim()).filter((key) => isSharedStateKvKey(key)))
    );

    let sanitizedPatchKv = rawPatchKv;
    let sanitizedDropKeys = rawDropKeys;

    if (viewer.role === "teacher" && viewer.teacherId) {
      const myStudentTokens = new Set(
        viewer.snapshot.students
          .filter((s) => s.teacherId === viewer.teacherId)
          .map((s) => (s.token ?? "").trim())
          .filter(Boolean)
      );
      sanitizedPatchKv = {};
      for (const [k, v] of Object.entries(rawPatchKv)) {
        if (isTeacherAllowedStateKvKey(k, myStudentTokens)) {
          sanitizedPatchKv[k] = v;
        }
      }
      sanitizedDropKeys = rawDropKeys.filter((k) => isTeacherAllowedStateKvKey(k, myStudentTokens));
    }

    // [선택지 B 핵심] DB 내부 원자적(Atomic) 부분 병합 RPC 우선 시도 (동시 덮어쓰기 Lost Update 원천 차단)
    // 이미 resolveViewerContext 및 위 RBAC 검증을 통과했으므로 serviceRoleKey가 있으면 기본 활용한다.
    try {
      const rpcUrl = new URL("/rest/v1/rpc/patch_snapshot_state_kv", cfg.url);
      const rpcRes = await fetch(rpcUrl.toString(), {
        method: "POST",
        headers: buildHeaders({
          cfg,
          accessToken: viewer.accessToken,
          json: true,
          useServiceRole: true,
        }),
        body: JSON.stringify({
          p_snapshot_id: SNAPSHOT_KEY,
          p_patch: sanitizedPatchKv,
          p_drop_keys: sanitizedDropKeys,
        }),
        cache: "no-store",
      });

      if (rpcRes.ok) {
        const rpcData = await rpcRes.json();
        if (rpcData === true) {
          stateKvUpdatedAtomically = true;
        }
      }
    } catch {
      // RPC 함수가 아직 생성되지 않았거나 일시 오류 시 아래 기존 병합(Fallback)으로 안전하게 이어짐
    }

    if (!stateKvUpdatedAtomically) {
      const currentResult = await fetchSnapshotRow({
        cfg,
        accessToken: viewer.accessToken,
        select: ["state_kv"],
        useServiceRole: true,
      });
      const currentRaw =
        currentResult.row?.state_kv && typeof currentResult.row.state_kv === "object"
          ? { ...currentResult.row.state_kv }
          : {};
      // [최적화] state_kv 내부에 누적된 레거시 일일 백업(mk3:backup:...)을 자동 제거하여 DB 페이로드 비대화 차단
      for (const key of Object.keys(currentRaw)) {
        if (key.startsWith("mk3:backup:")) {
          delete currentRaw[key];
        }
      }
      mergedStateKv = {
        ...currentRaw,
        ...sanitizedPatchKv,
      };
      for (const key of sanitizedDropKeys) {
        delete mergedStateKv[key];
      }
    }
  }

  const payload: {
    id: string;
    teachers?: Teacher[];
    students?: Student[];
    sessions?: Session[];
    state_kv?: Record<string, unknown>;
  } = { id: SNAPSHOT_KEY };

  let finalStudentsPayload: Student[] | undefined;
  if (hasStudents) {
    if (viewer.role === "student") {
      const patchStudent = args.patch.students?.[0];
      if (patchStudent && viewer.studentId) {
        finalStudentsPayload = viewer.snapshot.students.map((s) =>
          s.id === viewer.studentId ? { ...s, ...patchStudent } : s
        );
      } else {
        finalStudentsPayload = viewer.snapshot.students;
      }
    } else if (studentsMergeMode === "merge") {
      const rawPatchStudents = args.patch.students ?? [];
      if (viewer.role === "teacher" && viewer.teacherId) {
        const allowedPatch = filterTeacherAllowedStudentMergePatch(
          viewer.snapshot.students,
          rawPatchStudents,
          viewer.teacherId
        );
        finalStudentsPayload = mergeSnapshotEntitiesById(viewer.snapshot.students, allowedPatch);
      } else {
        finalStudentsPayload = mergeSnapshotEntitiesById(viewer.snapshot.students, rawPatchStudents);
      }
    } else if (viewer.role === "teacher" && viewer.teacherId) {
      // [동시성 보호] 선생님은 본인 담당 학생만 수정/저장하므로, 다른 선생님의 학생 정보는 최신 스냅샷에서 보존
      const patchMap = new Map((args.patch.students ?? []).map((s) => [s.id, s]));
      const otherStudents = viewer.snapshot.students.filter((s) => s.teacherId !== viewer.teacherId && !patchMap.has(s.id));
      finalStudentsPayload = [...otherStudents, ...(args.patch.students ?? [])];
    } else {
      finalStudentsPayload = args.patch.students ?? [];
    }
  }

  let finalSessionsPayload: Session[] | undefined;
  if (hasSessions) {
    const rawPatchSessions = args.patch.sessions ?? [];
    if (sessionsMergeMode === "merge") {
      if (viewer.role === "teacher" && viewer.teacherId) {
        const myStudentIds = new Set(
          viewer.snapshot.students.filter((s) => s.teacherId === viewer.teacherId).map((s) => s.id)
        );
        const allowedPatch = filterTeacherAllowedSessionMergePatch(
          viewer.snapshot.sessions,
          rawPatchSessions,
          myStudentIds
        );
        finalSessionsPayload = mergeSnapshotEntitiesById(viewer.snapshot.sessions, allowedPatch);
      } else {
        finalSessionsPayload = mergeSnapshotEntitiesById(viewer.snapshot.sessions, rawPatchSessions);
      }
    } else if (viewer.role === "teacher" && viewer.teacherId) {
      // [동시성 보호] 본인 담당 학생들의 세션만 패치로 갱신하고, 다른 선생님 담당 학생들의 세션은 최신 스냅샷에서 보존
      const myStudentIds = new Set(
        viewer.snapshot.students.filter((s) => s.teacherId === viewer.teacherId).map((s) => s.id)
      );
      const patchStudentIds = new Set(rawPatchSessions.map((s) => s.studentId));
      const untouchedSessions = viewer.snapshot.sessions.filter(
        (s) => !myStudentIds.has(s.studentId) && !patchStudentIds.has(s.studentId)
      );
      finalSessionsPayload = [...untouchedSessions, ...rawPatchSessions];
    } else {
      finalSessionsPayload = rawPatchSessions;
    }
  }

  if (hasTeachers) payload.teachers = args.patch.teachers ?? [];
  if (hasStudents) payload.students = finalStudentsPayload;
  if (hasSessions) payload.sessions = finalSessionsPayload;
  if (touchesStateKv && !stateKvUpdatedAtomically) payload.state_kv = mergedStateKv ?? {};

  // state_kv만 패치하는 요청이었고 이미 DB 원자적 RPC로 완료되었다면, 불필요한 전체 행 Upsert를 생략합니다.
  const hasRemainingColumns =
    hasTeachers || hasStudents || hasSessions || (touchesStateKv && !stateKvUpdatedAtomically);
  if (!hasRemainingColumns) {
    return { sessionsSynced: true, stateKvSynced: true };
  }

  const changedStudentsForDualWrite = hasStudents
    ? computeChangedRowsById(viewer.snapshot.students, finalStudentsPayload)
    : undefined;
  const changedSessionsForDualWrite = hasSessions
    ? computeChangedRowsById(viewer.snapshot.sessions, finalSessionsPayload)
    : undefined;

  const requestUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  requestUrl.searchParams.set("on_conflict", "id");

  const execute = async (bodyPayload: typeof payload) => {
    const res = await fetch(requestUrl.toString(), {
      method: "POST",
      headers: buildHeaders({
        cfg,
        accessToken: viewer.accessToken,
        json: true,
        preferMerge: true,
        useServiceRole: true,
      }),
      body: JSON.stringify([bodyPayload]),
      cache: "no-store",
    });

    if (res.ok) {
      return { ok: true as const, text: "", status: res.status };
    }
    return { ok: false as const, text: await res.text(), status: res.status };
  };

  const first = await execute(payload);
  if (first.ok) {
    // [Phase 3 + B단계 최적화] 전체 행 대신 실제로 변경된 학생/세션 행만 정규화 테이블에 경량 듀얼라이트
    if (
      (changedStudentsForDualWrite && changedStudentsForDualWrite.length > 0) ||
      (changedSessionsForDualWrite && changedSessionsForDualWrite.length > 0)
    ) {
      void executeDualWriteSync({
        students: changedStudentsForDualWrite,
        sessions: changedSessionsForDualWrite,
        cfg,
        accessToken: viewer.accessToken,
        useServiceRole: true,
      });
    }
    return { sessionsSynced: true, stateKvSynced: true };
  }

  const sessionsMissing = hasSessions && isMissingColumnError(first.text, "sessions");
  const stateKvMissing = touchesStateKv && isMissingColumnError(first.text, "state_kv");
  if (!sessionsMissing && !stateKvMissing) {
    throw new Error(`snapshot upsert failed: ${first.status} ${first.text}`);
  }

  const fallbackPayload: typeof payload = { id: SNAPSHOT_KEY };
  if (hasTeachers) fallbackPayload.teachers = args.patch.teachers ?? [];
  if (hasStudents) fallbackPayload.students = finalStudentsPayload;
  if (hasSessions && !sessionsMissing) fallbackPayload.sessions = finalSessionsPayload;
  if (touchesStateKv && !stateKvUpdatedAtomically && !stateKvMissing) fallbackPayload.state_kv = mergedStateKv ?? {};

  const fallback = await execute(fallbackPayload);
  if (!fallback.ok) {
    throw new Error(`snapshot upsert failed (fallback): ${fallback.status} ${fallback.text}`);
  }

  // [Phase 3 + B단계 최적화] fallback 분기에서도 변경분만 정규화 테이블에 경량 듀얼라이트
  if (
    (changedStudentsForDualWrite && changedStudentsForDualWrite.length > 0) ||
    (!sessionsMissing && changedSessionsForDualWrite && changedSessionsForDualWrite.length > 0)
  ) {
    void executeDualWriteSync({
      students: changedStudentsForDualWrite,
      sessions: sessionsMissing ? undefined : changedSessionsForDualWrite,
      cfg,
      accessToken: viewer.accessToken,
      useServiceRole: true,
    });
  }

  return {
    sessionsSynced: !hasSessions || !sessionsMissing,
    stateKvSynced: !touchesStateKv || !stateKvMissing,
  };
}
