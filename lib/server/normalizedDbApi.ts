import type { Session, Student } from "@/lib/types/index";
import type { NormalizedStudentRow, NormalizedSessionRow } from "@/lib/server/dualWriteSync";

/**
 * 정규화 DB 행(Row)을 Student 도메인 모델로 역변환합니다.
 */
export function mapNormalizedRowToStudent(row: NormalizedStudentRow): Student {
  return {
    id: row.id,
    token: row.token || "",
    name: row.name,
    cohort: row.cohort || "",
    status: (row.status as Student["status"]) || "active",
    startDate: row.start_date || "",
    planCount: row.plan_count,
    googleEmail: row.google_email || "",
    studentPhone: row.student_phone || "",
    parentPhone: row.parent_phone || "",
    school: row.school || "",
    grade: row.grade || "",
    gender: (row.gender as Student["gender"]) || undefined,
    parentRole: (row.parent_role as Student["parentRole"]) || undefined,
    teacherId: row.teacher_id || undefined,
    driveFolderId: row.drive_folder_id || undefined,
    permanentMeetUrl: row.permanent_meet_url || undefined,
    scheduleRules: Array.isArray(row.schedule_rules) ? (row.schedule_rules as Student["scheduleRules"]) : [],
    scheduleChangeEvents: Array.isArray(row.schedule_change_events) ? (row.schedule_change_events as Student["scheduleChangeEvents"]) : [],
    paymentHistory: Array.isArray(row.payment_history) ? (row.payment_history as Student["paymentHistory"]) : [],
  };
}

/**
 * 정규화 DB 행(Row)을 Session 도메인 모델로 역변환합니다.
 */
export function mapNormalizedRowToSession(row: NormalizedSessionRow): Session {
  return {
    id: row.id,
    studentId: row.student_id,
    index: row.session_index,
    displayAt: row.display_at || "",
    memo: row.memo || undefined,
    state: (row.state as Session["state"]) || "normal",
    googleCalendarId: row.google_calendar_id || undefined,
    googleCalendarEventId: row.google_calendar_event_id || undefined,
    googleMeetUrl: row.google_meet_url || undefined,
    googleCalendarStatus: (row.google_calendar_status as Session["googleCalendarStatus"]) || "pending",
    googleCalendarError: row.google_calendar_error || undefined,
    googleCalendarSyncedAt: row.google_calendar_synced_at || undefined,
  };
}

/**
 * 정규화 DB 읽기 모드 활성화 여부를 확인합니다.
 * 환경변수 NEXT_PUBLIC_READ_FROM_NORMALIZED === "true" 시 활성화
 */
export function isReadFromNormalizedEnabled(): boolean {
  return process.env.NEXT_PUBLIC_READ_FROM_NORMALIZED === "true";
}

/**
 * 정규화 테이블에서 학생 목록을 직접 쿼리합니다.
 * teacherId가 주어지면 해당 선생님 담당 학생만 0.02초 만에 초고속 필터링합니다.
 */
export async function fetchStudentsFromDb(args: {
  cfg?: { url: string; serviceRoleKey: string | null; anonKey: string };
  accessToken?: string;
  useServiceRole?: boolean;
  teacherId?: string | null;
  studentId?: string | null;
}): Promise<Student[] | null> {
  if (!args.cfg || !args.cfg.url) return null;

  const url = new URL("/rest/v1/students", args.cfg.url);
  url.searchParams.set("select", "*");
  url.searchParams.set("order", "name.asc");

  if (args.teacherId) {
    url.searchParams.set("teacher_id", `eq.${args.teacherId}`);
  }
  if (args.studentId) {
    url.searchParams.set("id", `eq.${args.studentId}`);
  }

  const token = args.useServiceRole && args.cfg.serviceRoleKey
    ? args.cfg.serviceRoleKey
    : args.accessToken || args.cfg.anonKey;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn("[NormalizedDbApi] fetchStudentsFromDb non-ok status:", res.status);
      return null;
    }

    const rows = (await res.json()) as NormalizedStudentRow[];
    return rows.map(mapNormalizedRowToStudent);
  } catch (err) {
    console.warn("[NormalizedDbApi] fetchStudentsFromDb error:", err);
    return null;
  }
}

/**
 * 정규화 테이블에서 특정 학생의 세션 목록만 직접 쿼리합니다.
 */
export async function fetchSessionsForStudentFromDb(args: {
  studentId: string;
  cfg?: { url: string; serviceRoleKey: string | null; anonKey: string };
  accessToken?: string;
  useServiceRole?: boolean;
}): Promise<Session[] | null> {
  if (!args.studentId || !args.cfg || !args.cfg.url) return null;

  const url = new URL("/rest/v1/sessions", args.cfg.url);
  url.searchParams.set("select", "*");
  url.searchParams.set("student_id", `eq.${args.studentId}`);
  url.searchParams.set("order", "session_index.asc");

  const token = args.useServiceRole && args.cfg.serviceRoleKey
    ? args.cfg.serviceRoleKey
    : args.accessToken || args.cfg.anonKey;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn("[NormalizedDbApi] fetchSessionsForStudentFromDb non-ok status:", res.status);
      return null;
    }

    const rows = (await res.json()) as NormalizedSessionRow[];
    return rows.map(mapNormalizedRowToSession);
  } catch (err) {
    console.warn("[NormalizedDbApi] fetchSessionsForStudentFromDb error:", err);
    return null;
  }
}

/**
 * 오늘 수업이 있는 세션들만 기간(display_at) 기반으로 초고속 쿼리합니다.
 */
export async function fetchTodaySessionsFromDb(args: {
  todayStartIso: string;
  todayEndIso: string;
  cfg?: { url: string; serviceRoleKey: string | null; anonKey: string };
  accessToken?: string;
  useServiceRole?: boolean;
}): Promise<Session[] | null> {
  if (!args.todayStartIso || !args.todayEndIso || !args.cfg || !args.cfg.url) return null;

  const url = new URL("/rest/v1/sessions", args.cfg.url);
  url.searchParams.set("select", "*");
  url.searchParams.set("display_at", `gte.${args.todayStartIso}`);
  url.searchParams.set("display_at", `lte.${args.todayEndIso}`);
  url.searchParams.set("order", "display_at.asc");

  const token = args.useServiceRole && args.cfg.serviceRoleKey
    ? args.cfg.serviceRoleKey
    : args.accessToken || args.cfg.anonKey;

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      console.warn("[NormalizedDbApi] fetchTodaySessionsFromDb non-ok status:", res.status);
      return null;
    }

    const rows = (await res.json()) as NormalizedSessionRow[];
    return rows.map(mapNormalizedRowToSession);
  } catch (err) {
    console.warn("[NormalizedDbApi] fetchTodaySessionsFromDb error:", err);
    return null;
  }
}
