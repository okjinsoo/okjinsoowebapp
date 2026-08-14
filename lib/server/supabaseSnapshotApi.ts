import "server-only";

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
import { isSharedStateKvKey } from "@/lib/storage/sharedStateKeys";
import type { Session, Student, Teacher } from "@/lib/types/index";

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

export type SnapshotPatch = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  stateKv?: Record<string, string>;
  dropStateKeys?: string[];
};

/**
 * [V18 최적화] 데이터의 변경 여부를 짧은 문자열로 요약합니다.
 * 본문 전체를 보내기 전에 이 값을 비교하여 바뀐 게 없으면 전송을 생략합니다.
 */
export function calculateSnapshotDigest(snapshot: NormalizedSnapshot): string {
  const tCount = snapshot.teachers.length;
  const sCount = snapshot.students.length;
  const sessCount = snapshot.sessions.length;
  const kvKeys = Object.keys(snapshot.stateKv).sort();
  const kvCount = kvKeys.length;
  
  // [Phase 24.3 개선] 단순히 키 개수만 세는 게 아니라, 내용물의 변화를 감지할 수 있는 지문 생성
  // 데이터가 너무 크면 성능 저하가 올 수 있으므로 하이브리드 방식을 사용합니다.
  const kvSample = kvKeys.slice(-3).map(k => {
    const val = snapshot.stateKv[k] || "";
    return `${k}:${val.length}:${val.slice(-20)}`; // 키 이름, 길이, 마지막 20글자 조합
  }).join("|");

  const sample = JSON.stringify({
    tc: tCount,
    sc: sCount,
    sec: sessCount,
    kc: kvCount,
    ks: kvSample, // [핵심] 주요 KV 데이터의 상태 샘플 포함
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
  const useServiceRole = Boolean(args.useServiceRole && args.cfg.serviceRoleKey);
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

export async function resolveViewerContext(request: NextRequest): Promise<ViewerContext | null> {
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

  if (hasLocalDevAdminSession(request)) {
    if (!cfg.serviceRoleKey) return null;
    const snapshotStartMs = Date.now();
    const snapshotResult = await fetchSnapshotRow({
      cfg,
      accessToken: cfg.serviceRoleKey,
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
    fetchSnapshotRow({ cfg, accessToken }),
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

export async function upsertSnapshotPatch(args: {
  request: NextRequest;
  patch: SnapshotPatch;
}): Promise<{ sessionsSynced: boolean; stateKvSynced: boolean }> {
  const cfg = getSupabaseServerConfig();
  const viewer = await resolveViewerContext(args.request);
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

  // [Phase 23] 서버 사이드 권한/무결성 검증
  // 1. 관리자만 선생님 정보를 수정할 수 있음
  if (hasTeachers && viewer.role !== "admin") {
    logGuard("UNAUTHORIZED_TEACHER_EDIT");
    throw new Error("unauthorized_teacher_edit");
  }

  // 2. 학생 계정의 제약 사항
  if (viewer.role === "student") {
    if (hasStudents) {
      // 학생은 본인의 정보만 수정 가능하며, 특정 필드(결제 횟수 등)는 수정 불가
      const patchStudents = args.patch.students ?? [];
      const isTryingToEditOthers = patchStudents.some(s => s.id !== viewer.studentId);
      if (isTryingToEditOthers) {
        logGuard("UNAUTHORIZED_STUDENT_EDIT_TARGET", {
          patchStudentCount: patchStudents.length,
          viewerStudentId: viewer.studentId,
        });
        throw new Error("unauthorized_student_edit_target");
      }

      // 중요 필드(planCount, paymentHistory) 조작 방지
      // (기존 스냅샷 데이터를 가져와서 학생이 보낸 패치와 대조)
      const currentStudent = viewer.snapshot.students.find(s => s.id === viewer.studentId);
      if (currentStudent) {
        for (const s of patchStudents) {
          if (s.planCount !== currentStudent.planCount || 
              JSON.stringify(s.paymentHistory) !== JSON.stringify(currentStudent.paymentHistory)) {
             logGuard("UNAUTHORIZED_STUDENT_FIELD_MANIPULATION", {
               studentId: s.id,
             });
             throw new Error("unauthorized_field_manipulation");
          }
        }
      }
    }

    if (hasSessions) {
      // 학생은 본인의 세션만 업데이트 가능
      const patchSessions = args.patch.sessions ?? [];
      const hasOtherStudentSessions = patchSessions.some(s => s.studentId !== viewer.studentId);
      if (hasOtherStudentSessions) {
        logGuard("UNAUTHORIZED_SESSION_EDIT_TARGET", {
          patchSessionCount: patchSessions.length,
          viewerStudentId: viewer.studentId,
        });
        throw new Error("unauthorized_session_edit_target");
      }
    }
  }

  if (hasStudents && viewer.role !== "student") {
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
  if (touchesStateKv) {
    const currentResult = await fetchSnapshotRow({
      cfg,
      accessToken: viewer.accessToken,
      select: ["state_kv"],
      useServiceRole: viewer.isLocalDevAdmin,
    });
    const currentRaw =
      currentResult.row?.state_kv && typeof currentResult.row.state_kv === "object"
        ? { ...currentResult.row.state_kv }
        : {};
    const dropStateKeys = Array.from(
      new Set((args.patch.dropStateKeys ?? []).map((key) => key.trim()).filter((key) => isSharedStateKvKey(key)))
    );
    mergedStateKv = {
      ...currentRaw,
      ...toStateKv(args.patch.stateKv ?? {}),
    };
    for (const key of dropStateKeys) {
      delete mergedStateKv[key];
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
    if (viewer.role === "teacher" && viewer.teacherId) {
      // [동시성 보호] 본인 담당 학생들의 세션만 패치로 갱신하고, 다른 선생님 담당 학생들의 세션은 최신 스냅샷에서 보존
      const myStudentIds = new Set(
        viewer.snapshot.students.filter((s) => s.teacherId === viewer.teacherId).map((s) => s.id)
      );
      const patchSessions = args.patch.sessions ?? [];
      const patchStudentIds = new Set(patchSessions.map((s) => s.studentId));
      const untouchedSessions = viewer.snapshot.sessions.filter(
        (s) => !myStudentIds.has(s.studentId) && !patchStudentIds.has(s.studentId)
      );
      finalSessionsPayload = [...untouchedSessions, ...patchSessions];
    } else {
      finalSessionsPayload = args.patch.sessions ?? [];
    }
  }

  // [Phase 23 보안] 권한별 쓰기 제한
  if (viewer.role === "student") {
    // 1. 자신의 학생 정보만 수정 가능 (전체 학생 명단 수정 시도 차단)
    if (hasStudents) {
      if (!args.patch.students || args.patch.students.length > 1 || args.patch.students[0]?.id !== viewer.studentId) {
        logGuard("UNAUTHORIZED_STUDENT_DATA_MANIPULATION");
        throw new Error("unauthorized_student_data_manipulation");
      }
      // 2. 민감 정보(결제, 횟수 등) 수정 시도 차단
      const currentStudent = viewer.snapshot.students.find(s => s.id === viewer.studentId);
      const patchStudent = args.patch.students[0];
      if (currentStudent && patchStudent) {
        if (patchStudent.planCount !== currentStudent.planCount || 
            JSON.stringify(patchStudent.paymentHistory) !== JSON.stringify(currentStudent.paymentHistory)) {
          logGuard("UNAUTHORIZED_FINANCIAL_DATA_MANIPULATION", {
            studentId: patchStudent.id,
          });
          throw new Error("unauthorized_financial_data_manipulation");
        }
      }
    }
    // 3. 수업(sessions) 및 선생님 정보 수정 차단
    if (hasSessions || hasTeachers) {
      logGuard("UNAUTHORIZED_SESSION_OR_TEACHER_MANIPULATION", {
        hasSessions,
        hasTeachers,
      });
      throw new Error("unauthorized_session_or_teacher_manipulation");
    }
    // 4. 전역 설정(stateKv) 수정 차단
    if (touchesStateKv) {
       logGuard("UNAUTHORIZED_METADATA_MANIPULATION");
       throw new Error("unauthorized_metadata_manipulation");
    }
  }

  if (hasTeachers) payload.teachers = args.patch.teachers ?? [];
  if (hasStudents) payload.students = finalStudentsPayload;
  if (hasSessions) payload.sessions = finalSessionsPayload;
  if (touchesStateKv) payload.state_kv = mergedStateKv ?? {};

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
        useServiceRole: viewer.isLocalDevAdmin,
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
  if (touchesStateKv && !stateKvMissing) fallbackPayload.state_kv = mergedStateKv ?? {};

  const fallback = await execute(fallbackPayload);
  if (!fallback.ok) {
    throw new Error(`snapshot upsert failed (fallback): ${fallback.status} ${fallback.text}`);
  }

  return {
    sessionsSynced: !hasSessions || !sessionsMissing,
    stateKvSynced: !touchesStateKv || !stateKvMissing,
  };
}
