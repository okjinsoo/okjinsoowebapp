import "server-only";

import type { Session, Student, Teacher, ConsultationRecord } from "@/lib/types/index";
import { SHARED_CONSULTATIONS_KEY, isSharedStateKvKey } from "@/lib/storage/sharedStateKeys";

const SNAPSHOT_KEY = "main";

type SupabaseConfigAdmin = {
  url: string;
  serviceRoleKey: string;
};

type SnapshotRow = {
  teachers?: Teacher[];
  students?: Student[];
  sessions?: Session[];
  state_kv?: Record<string, unknown> | null;
};

export type ParentViewData = {
  student: Student;
  teacherName: string | null;
  sessions: Session[];
  consultations: ConsultationRecord[];
};

export function getSupabaseAdminConfig(): SupabaseConfigAdmin | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
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

export async function fetchMainSnapshotAsAdmin(config: SupabaseConfigAdmin): Promise<{
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
  stateKv: Record<string, string>;
} | null> {
  const baseUrl = new URL("/rest/v1/app_state_snapshots", config.url);
  const selectFields = ["teachers", "students", "sessions", "state_kv"];

  while (selectFields.length >= 1) {
    const requestUrl = new URL(baseUrl.toString());
    requestUrl.searchParams.set("select", selectFields.join(","));
    requestUrl.searchParams.set("id", `eq.${SNAPSHOT_KEY}`);
    requestUrl.searchParams.set("limit", "1");

    const res = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      cache: "no-store",
    });

    if (res.ok) {
      const rows = (await res.json()) as SnapshotRow[];
      const row = rows[0] ?? null;
      return {
        teachers: Array.isArray(row?.teachers) ? row.teachers : [],
        students: Array.isArray(row?.students) ? row.students : [],
        sessions: Array.isArray(row?.sessions) ? row.sessions : [],
        stateKv: toStateKv(row?.state_kv),
      };
    }

    const text = await res.text();
    let changed = false;
    const lowerText = text.toLowerCase();

    // Fallback logic incase columns are missing
    if (selectFields.includes("sessions") && (lowerText.includes("sessions") || lowerText.includes("schema cache") || lowerText.includes("42703"))) {
      selectFields.splice(selectFields.indexOf("sessions"), 1);
      changed = true;
    }
    if (selectFields.includes("state_kv") && (lowerText.includes("state_kv") || lowerText.includes("schema cache") || lowerText.includes("42703"))) {
      selectFields.splice(selectFields.indexOf("state_kv"), 1);
      changed = true;
    }
    if (changed) continue;
    throw new Error(`snapshot admin fetch failed: ${res.status} ${text}`);
  }
  return null;
}

/**
 * 학부모 참관실용 데이터 불러오기 함수 (토큰 기반)
 */
export async function fetchParentViewData(token: string): Promise<ParentViewData | null> {
  const config = getSupabaseAdminConfig();
  if (!config) throw new Error("Supabase admin config not found. Please check SUPABASE_SERVICE_ROLE_KEY.");

  const snapshot = await fetchMainSnapshotAsAdmin(config);
  if (!snapshot) return null;

  // 토큰으로 학생 찾기
  const student = snapshot.students.find(s => s.token === token);
  if (!student) return null;

  // 담당 선생님 찾기
  const teacher = snapshot.teachers.find(t => t.id === student.teacherId);
  const teacherName = teacher?.name ?? null;

  // 해당 학생의 수업 정보 가져오기
  const sessions = snapshot.sessions.filter(s => s.studentId === student.id);

  // 해당 학생의 상담 기록 파싱하기
  let consultations: ConsultationRecord[] = [];
  const consultRaw = snapshot.stateKv[SHARED_CONSULTATIONS_KEY];
  if (consultRaw) {
    try {
      const parsed = JSON.parse(consultRaw) as Record<string, ConsultationRecord[]>;
      const list = parsed[student.id];
      if (Array.isArray(list)) consultations = list;
    } catch {
      // ignore JSON parse error
    }
  }

  return {
    student,
    teacherName,
    sessions,
    consultations,
  };
}
