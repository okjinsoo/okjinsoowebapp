// lib/storage/sessions.ts
import { pushSharedSnapshot, readLocalStudents, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import type { Session } from "@/lib/types/index";

const KEY = "tutorweb_sessions_v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  return safeParse<Session[]>(localStorage.getItem(KEY), []);
}

function syncSharedSnapshot(nextSessions: Session[]): void {
  void pushSharedSnapshot({
    teachers: readLocalTeachers(),
    students: readLocalStudents(),
    sessions: nextSessions,
  }).catch((err) => {
    console.error("공유 스냅샷 동기화 실패(sessions):", err);
  });
}

export function saveSessions(list: Session[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("tutorweb:sessionsUpdated"));
  syncSharedSnapshot(list);
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
  saveSessions(list);
  return list;
}

export function removeSessionsByStudentIds(studentIds: string[]): Session[] {
  const set = new Set(studentIds);
  const list = loadSessions().filter((s) => !set.has(s.studentId));
  saveSessions(list);
  return list;
}

export function removeSession(sessionId: string): Session[] {
  const list = loadSessions().filter((x) => x.id !== sessionId);
  saveSessions(list);
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
      const raw = localStorage.getItem(itemsKey(token, i));
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
  localStorage.removeItem(KEY);
  syncSharedSnapshot([]);
}
