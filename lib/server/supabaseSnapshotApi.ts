import "server-only";

import type { NextRequest } from "next/server";

import { SHARED_CONSULTATIONS_KEY, isSharedStateKvKey } from "@/lib/storage/sharedStateKeys";
import type { ConsultationRecord, Session, Student, Teacher } from "@/lib/types/index";

const SNAPSHOT_KEY = "main";
const AUTH_COOKIE_KEY = "tutorweb_auth_session_bridge_v1";
const FIXED_ADMIN_EMAILS = new Set(["rapah0310@gmail.com"]);

type SupabaseConfig = {
  url: string;
  anonKey: string;
};

type AuthCookieSession = {
  accessToken?: string;
  userId?: string | null;
  email?: string | null;
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
  // 간단하고 빠른 해시 대용: 핵심 데이터의 개수와 마지막 요소들의 특징을 조합
  const tCount = snapshot.teachers.length;
  const sCount = snapshot.students.length;
  const sessCount = snapshot.sessions.length;
  const kvCount = Object.keys(snapshot.stateKv).length;
  
  // 데이터가 많을 경우 전체를 JSON.stringify 하는 것도 비용이므로, 
  // 구조적 특징과 샘플 데이터를 조합하여 지문을 만듭니다.
  const sample = JSON.stringify({
    tc: tCount,
    sc: sCount,
    sec: sessCount,
    kc: kvCount,
    // 마지막 세션의 ID와 상태Kv의 키들만 포함해도 대부분의 변경을 감지 가능
    ls: snapshot.sessions[sessCount - 1]?.id ?? "",
    lk: Object.keys(snapshot.stateKv).sort().slice(-1)[0] ?? ""
  });
  
  return Buffer.from(sample).toString("base64");
}

function getSupabaseServerConfig(): SupabaseConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function parseAuthCookie(request: NextRequest): AuthCookieSession | null {
  const fromCookie = request.cookies.get(AUTH_COOKIE_KEY)?.value ?? null;
  if (fromCookie) {
    try {
      const parsed = JSON.parse(fromCookie) as AuthCookieSession;
      if (parsed && typeof parsed.accessToken === "string" && parsed.accessToken.trim()) {
        return parsed;
      }
    } catch {
      // invalid cookie -> ignore
    }
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    return {
      accessToken: authHeader.slice(7).trim(),
      userId: null,
      email: null,
    };
  }

  return null;
}

function buildHeaders(args: {
  cfg: SupabaseConfig;
  accessToken: string;
  json?: boolean;
  preferMerge?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: args.cfg.anonKey,
    Authorization: `Bearer ${args.accessToken}`,
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

async function fetchSupabaseUser(args: {
  cfg: SupabaseConfig;
  accessToken: string;
}): Promise<{ id: string | null; email: string | null }> {
  const res = await fetch(`${args.cfg.url}/auth/v1/user`, {
    method: "GET",
    headers: buildHeaders({ cfg: args.cfg, accessToken: args.accessToken }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const body = (await res.json()) as { id?: string; email?: string };
  return {
    id: typeof body.id === "string" ? body.id : null,
    email: typeof body.email === "string" ? body.email : null,
  };
}

async function fetchRoleBinding(args: {
  cfg: SupabaseConfig;
  accessToken: string;
  email: string;
}): Promise<ViewerRole | null> {
  const url = new URL("/rest/v1/role_bindings", args.cfg.url);
  url.searchParams.set("select", "role");
  url.searchParams.set("email", `eq.${args.email}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: buildHeaders({ cfg: args.cfg, accessToken: args.accessToken }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const rows = (await res.json()) as Array<{ role?: string }>;
  const role = rows[0]?.role;
  if (role === "teacher" || role === "student") return role;
  return null;
}

async function fetchSnapshotRow(args: {
  cfg: SupabaseConfig;
  accessToken: string;
  select?: string[];
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
      headers: buildHeaders({ cfg: args.cfg, accessToken: args.accessToken }),
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

function resolveStudentId(email: string, snapshot: NormalizedSnapshot): string | null {
  if (!email) return null;
  const student = snapshot.students.find((row) => normalizeEmail(row.googleEmail) === email);
  return student?.id ?? null;
}

export async function resolveViewerContext(request: NextRequest): Promise<ViewerContext | null> {
  const cfg = getSupabaseServerConfig();
  const auth = parseAuthCookie(request);
  const accessToken = auth?.accessToken?.trim() ?? "";
  if (!cfg || !accessToken) return null;

  let user: { id: string | null; email: string | null };
  try {
    user = await fetchSupabaseUser({ cfg, accessToken });
  } catch {
    return null;
  }

  const snapshotResult = await fetchSnapshotRow({ cfg, accessToken });
  const snapshot = normalizeSnapshot(snapshotResult.row, snapshotResult.missing);
  const normalizedEmail = normalizeEmail(user.email ?? auth?.email ?? "");
  const email = normalizedEmail || null;

  let role: ViewerRole = "guest";
  if (email && FIXED_ADMIN_EMAILS.has(email)) {
    role = "admin";
  } else if (email) {
    try {
      role = (await fetchRoleBinding({ cfg, accessToken, email })) ?? "guest";
    } catch {
      role = "guest";
    }

    if (role === "guest") {
      role = resolveFallbackRole(email, snapshot) ?? "guest";
    }
  }

  const teacherId = email ? resolveTeacherId(email, snapshot) : null;
  const studentId = email ? resolveStudentId(email, snapshot) : null;

  return {
    accessToken,
    email,
    userId: user.id,
    role,
    teacherId,
    studentId,
    snapshot,
    digest: calculateSnapshotDigest(snapshot), // [V18 추가]
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

export function readConsultationsForStudent(viewer: ViewerContext, studentId: string): ConsultationRecord[] {
  if (!canReadStudent(viewer, studentId)) return [];
  const raw = viewer.snapshot.stateKv[SHARED_CONSULTATIONS_KEY];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Record<string, ConsultationRecord[]>;
    const list = parsed?.[studentId];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
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

  const hasTeachers = Object.prototype.hasOwnProperty.call(args.patch, "teachers");
  const hasStudents = Object.prototype.hasOwnProperty.call(args.patch, "students");
  const hasSessions = Object.prototype.hasOwnProperty.call(args.patch, "sessions");
  const hasStateKv = Object.prototype.hasOwnProperty.call(args.patch, "stateKv");
  const hasDropStateKeys = Object.prototype.hasOwnProperty.call(args.patch, "dropStateKeys");
  const touchesStateKv = hasStateKv || hasDropStateKeys;

  // [Phase 23] 서버 사이드 권한/무결성 검증
  // 1. 관리자만 선생님 정보를 수정할 수 있음
  if (hasTeachers && viewer.role !== "admin") {
    console.error(`[Security] Unauthorized teacher update attempt by ${viewer.email} (Role: ${viewer.role})`);
    throw new Error("unauthorized_teacher_edit");
  }

  // 2. 학생 계정의 제약 사항
  if (viewer.role === "student") {
    if (hasStudents) {
      // 학생은 본인의 정보만 수정 가능하며, 특정 필드(결제 횟수 등)는 수정 불가
      const patchStudents = args.patch.students ?? [];
      const isTryingToEditOthers = patchStudents.some(s => s.id !== viewer.studentId);
      if (isTryingToEditOthers) {
        throw new Error("unauthorized_student_edit_target");
      }

      // 중요 필드(planCount, paymentHistory) 조작 방지
      // (기존 스냅샷 데이터를 가져와서 학생이 보낸 패치와 대조)
      const currentStudent = viewer.snapshot.students.find(s => s.id === viewer.studentId);
      if (currentStudent) {
        for (const s of patchStudents) {
          if (s.planCount !== currentStudent.planCount || 
              JSON.stringify(s.paymentHistory) !== JSON.stringify(currentStudent.paymentHistory)) {
             console.error(`[Security] Student ${viewer.email} tried to manipulate planCount/paymentHistory`);
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
        throw new Error("unauthorized_session_edit_target");
      }
    }
  }

  let mergedStateKv: Record<string, string> | undefined;
  if (touchesStateKv) {
    const currentResult = await fetchSnapshotRow({
      cfg,
      accessToken: viewer.accessToken,
      select: ["state_kv"],
    });
    const current = normalizeSnapshot(currentResult.row, currentResult.missing).stateKv;
    const dropStateKeys = Array.from(
      new Set((args.patch.dropStateKeys ?? []).map((key) => key.trim()).filter((key) => isSharedStateKvKey(key)))
    );
    mergedStateKv = {
      ...current,
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
    state_kv?: Record<string, string>;
  } = { id: SNAPSHOT_KEY };

  // [Phase 23 보안] 권한별 쓰기 제한
  if (viewer.role === "student") {
    // 1. 자신의 학생 정보만 수정 가능 (전체 학생 명단 수정 시도 차단)
    if (hasStudents) {
      if (!args.patch.students || args.patch.students.length > 1 || args.patch.students[0]?.id !== viewer.studentId) {
        throw new Error("unauthorized_student_data_manipulation");
      }
      // 2. 민감 정보(결제, 횟수 등) 수정 시도 차단
      const currentStudent = viewer.snapshot.students.find(s => s.id === viewer.studentId);
      const patchStudent = args.patch.students[0];
      if (currentStudent && patchStudent) {
        if (patchStudent.planCount !== currentStudent.planCount || 
            JSON.stringify(patchStudent.paymentHistory) !== JSON.stringify(currentStudent.paymentHistory)) {
          throw new Error("unauthorized_financial_data_manipulation");
        }
      }
    }
    // 3. 수업(sessions) 및 선생님 정보 수정 차단
    if (hasSessions || hasTeachers) {
      throw new Error("unauthorized_session_or_teacher_manipulation");
    }
    // 4. 전역 설정(stateKv) 수정 차단
    if (touchesStateKv) {
       throw new Error("unauthorized_metadata_manipulation");
    }
  }

  if (hasTeachers) payload.teachers = args.patch.teachers ?? [];
  if (hasStudents) payload.students = args.patch.students ?? [];
  if (hasSessions) payload.sessions = args.patch.sessions ?? [];
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
  if (hasStudents) fallbackPayload.students = args.patch.students ?? [];
  if (hasSessions && !sessionsMissing) fallbackPayload.sessions = args.patch.sessions ?? [];
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
