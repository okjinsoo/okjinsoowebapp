import type { Session, Student } from "@/lib/types/index";

export type NormalizedStudentRow = {
  id: string;
  token: string | null;
  name: string;
  cohort: string;
  status: string;
  start_date: string | null;
  plan_count: number;
  google_email: string | null;
  student_phone: string | null;
  parent_phone: string | null;
  school: string | null;
  grade: string | null;
  gender: string | null;
  parent_role: string | null;
  teacher_id: string | null;
  drive_folder_id: string | null;
  permanent_meet_url: string | null;
  schedule_rules: unknown;
  schedule_change_events: unknown;
  payment_history: unknown;
  updated_at: string;
};

export type NormalizedSessionRow = {
  id: string;
  student_id: string;
  session_index: number;
  display_at: string | null;
  memo: string;
  state: string;
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
  google_meet_url: string | null;
  google_calendar_status: string;
  google_calendar_error: string;
  google_calendar_synced_at: string | null;
  updated_at: string;
};

/**
 * Student 객체를 DB students 테이블 정규화 레코드로 변환합니다.
 */
export function mapStudentToNormalizedRow(student: Student): NormalizedStudentRow {
  return {
    id: student.id,
    token: student.token || null,
    name: student.name,
    cohort: student.cohort ?? "",
    status: student.status ?? "active",
    start_date: student.startDate || null,
    plan_count: student.planCount ?? 4,
    google_email: student.googleEmail || null,
    student_phone: student.studentPhone || null,
    parent_phone: student.parentPhone || null,
    school: student.school || null,
    grade: student.grade || null,
    gender: student.gender || null,
    parent_role: student.parentRole || null,
    teacher_id: student.teacherId || null,
    drive_folder_id: student.driveFolderId || null,
    permanent_meet_url: student.permanentMeetUrl || null,
    schedule_rules: student.scheduleRules ?? [],
    schedule_change_events: student.scheduleChangeEvents ?? [],
    payment_history: student.paymentHistory ?? [],
    updated_at: new Date().toISOString(),
  };
}

/**
 * Session 객체를 DB sessions 테이블 정규화 레코드로 변환합니다.
 */
export function mapSessionToNormalizedRow(session: Session): NormalizedSessionRow {
  return {
    id: session.id,
    student_id: session.studentId,
    session_index: session.index,
    display_at: session.displayAt || null,
    memo: session.memo ?? "",
    state: session.state ?? "normal",
    google_calendar_id: session.googleCalendarId || null,
    google_calendar_event_id: session.googleCalendarEventId || null,
    google_meet_url: session.googleMeetUrl || null,
    google_calendar_status: session.googleCalendarStatus ?? "pending",
    google_calendar_error: session.googleCalendarError ?? "",
    google_calendar_synced_at: session.googleCalendarSyncedAt || null,
    updated_at: new Date().toISOString(),
  };
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * 스냅샷 패치 시 정규화 테이블(students, sessions)로 무중단 듀얼 라이트를 비동기 실행합니다.
 * 에러가 발생해도 기존 스냅샷 저장 흐름을 방해하지 않도록 안전하게 격리됩니다.
 */
export async function executeDualWriteSync(args: {
  students?: Student[];
  sessions?: Session[];
  cfg?: { url: string; serviceRoleKey: string | null; anonKey: string };
  accessToken?: string;
  useServiceRole?: boolean;
}): Promise<{ studentsWritten: number; sessionsWritten: number }> {
  const result = { studentsWritten: 0, sessionsWritten: 0 };
  if (!args.cfg || !args.cfg.url) return result;

  const url = args.cfg.url;
  const token = args.useServiceRole && args.cfg.serviceRoleKey ? args.cfg.serviceRoleKey : args.accessToken || args.cfg.anonKey;
  const headers = {
    "Content-Type": "application/json",
    apikey: token,
    Authorization: `Bearer ${token}`,
    Prefer: "resolution=merge-duplicates",
  };

  try {
    // 1. 학생 테이블 듀얼 라이트 (100개씩 청크 분할)
    if (args.students && args.students.length > 0) {
      const studentRows = args.students.map(mapStudentToNormalizedRow);
      const studentChunks = chunkArray(studentRows, 100);
      const studentUrl = new URL("/rest/v1/students?on_conflict=id", url);

      for (const chunk of studentChunks) {
        const res = await fetch(studentUrl.toString(), {
          method: "POST",
          headers,
          body: JSON.stringify(chunk),
          cache: "no-store",
        });
        if (res.ok) {
          result.studentsWritten += chunk.length;
        } else {
          console.warn("[DualWrite] students chunk sync non-critical warning:", res.status);
        }
      }
    }

    // 2. 세션 테이블 듀얼 라이트 (100개씩 청크 분할)
    if (args.sessions && args.sessions.length > 0) {
      const sessionRows = args.sessions.map(mapSessionToNormalizedRow);
      const sessionChunks = chunkArray(sessionRows, 100);
      const sessionUrl = new URL("/rest/v1/sessions?on_conflict=id", url);

      for (const chunk of sessionChunks) {
        const res = await fetch(sessionUrl.toString(), {
          method: "POST",
          headers,
          body: JSON.stringify(chunk),
          cache: "no-store",
        });
        if (res.ok) {
          result.sessionsWritten += chunk.length;
        } else {
          console.warn("[DualWrite] sessions chunk sync non-critical warning:", res.status);
        }
      }
    }
  } catch (err) {
    console.warn("[DualWrite] execution ignored error (non-blocking):", err);
  }

  return result;
}

/**
 * 정규화 테이블의 현재 저장된 레코드 개수를 카운트합니다.
 */
export async function getNormalizedTableCounts(args: {
  cfg?: { url: string; serviceRoleKey: string | null; anonKey: string };
  accessToken?: string;
  useServiceRole?: boolean;
}): Promise<{ studentsCount: number; sessionsCount: number }> {
  const result = { studentsCount: 0, sessionsCount: 0 };
  if (!args.cfg || !args.cfg.url) return result;

  const url = args.cfg.url;
  const token = args.useServiceRole && args.cfg.serviceRoleKey ? args.cfg.serviceRoleKey : args.accessToken || args.cfg.anonKey;
  const headers = {
    apikey: token,
    Authorization: `Bearer ${token}`,
    Prefer: "count=exact",
    Range: "0-0",
  };

  try {
    const studentUrl = new URL("/rest/v1/students?select=id", url);
    const sRes = await fetch(studentUrl.toString(), { method: "HEAD", headers, cache: "no-store" });
    const sRange = sRes.headers.get("content-range") || "";
    const sCount = Number(sRange.split("/")[1] || 0);
    if (!Number.isNaN(sCount)) result.studentsCount = sCount;

    const sessionUrl = new URL("/rest/v1/sessions?select=id", url);
    const sesRes = await fetch(sessionUrl.toString(), { method: "HEAD", headers, cache: "no-store" });
    const sesRange = sesRes.headers.get("content-range") || "";
    const sesCount = Number(sesRange.split("/")[1] || 0);
    if (!Number.isNaN(sesCount)) result.sessionsCount = sesCount;
  } catch (err) {
    console.warn("[DualWrite] getNormalizedTableCounts failed:", err);
  }

  return result;
}

/**
 * 기존 스냅샷 데이터를 신규 정규화 테이블로 100% 전수 이관(Backfill)합니다.
 */
export async function backfillNormalizedTables(args: {
  students: Student[];
  sessions: Session[];
  cfg?: { url: string; serviceRoleKey: string | null; anonKey: string };
  accessToken?: string;
  useServiceRole?: boolean;
}): Promise<{
  studentsTotal: number;
  studentsBackfilled: number;
  sessionsTotal: number;
  sessionsBackfilled: number;
  elapsedMs: number;
}> {
  const startMs = Date.now();
  const res = await executeDualWriteSync({
    students: args.students,
    sessions: args.sessions,
    cfg: args.cfg,
    accessToken: args.accessToken,
    useServiceRole: args.useServiceRole,
  });
  return {
    studentsTotal: args.students.length,
    studentsBackfilled: res.studentsWritten,
    sessionsTotal: args.sessions.length,
    sessionsBackfilled: res.sessionsWritten,
    elapsedMs: Date.now() - startMs,
  };
}
