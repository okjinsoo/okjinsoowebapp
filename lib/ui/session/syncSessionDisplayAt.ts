"use client";

import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import {
  buildBaseDatesISO,
  buildUpdatedMetaMap,
  computeEffectiveISO,
  readMetaMap,
  type SessionMeta,
} from "@/lib/ui/session/sessionEffective";
import { browserStorage } from "@/lib/storage/browserStorage";
import { findStudentByTokenInRows, readSnapshotServerFirst } from "@/lib/storage/serverRead";
import { saveSessions } from "@/lib/storage/sessions";
import {
  pushSharedSnapshot,
  readLocalSessions,
  readLocalStudents,
} from "@/lib/storage/sharedSnapshot";
import type { Session, Student } from "@/lib/types/index";

function computeNextSessionsForStudent(args: {
  token: string;
  student: Student;
  sessions: Session[];
  metaMap: Record<number, SessionMeta>;
  forceResyncIndex?: number | null;
}): { nextSessions: Session[]; changedSessions: Session[]; changed: boolean } {
  const { token, student, sessions, metaMap, forceResyncIndex } = args;
  const own = sessions.filter((s) => s.studentId === student.id && !s.id.startsWith("virtual_"));
  if (own.length === 0) return { nextSessions: sessions, changedSessions: [], changed: false };

  const maxIndex = own.reduce((m, s) => Math.max(m, s.index), 0);
  const baseDatesISO = buildBaseDatesISO(
    student,
    Math.max(120, student.planCount ?? 0, maxIndex),
    metaMap
  );

  let changed = false;
  const changedSessions: Session[] = [];
  const nextSessions = sessions.map((session) => {
    if (session.studentId !== student.id || session.id.startsWith("virtual_")) return session;

    const { effectiveISO } = computeEffectiveISO({
      token,
      index: session.index,
      baseDatesISO,
      metaMap,
    });
    const displayAtChanged = Boolean(effectiveISO && effectiveISO !== session.displayAt);
    const durationResyncNeeded =
      typeof forceResyncIndex === "number" &&
      session.index === forceResyncIndex &&
      !displayAtChanged;

    if (!displayAtChanged && !durationResyncNeeded) return session;

    changed = true;
    const updated: Session = {
      ...session,
      ...(displayAtChanged && effectiveISO ? { displayAt: effectiveISO } : {}),
      // 시작 시각은 같고 수업 시간(overrideDurationMin)만 바뀐 경우에도 구글 캘린더 종료 시간이 자동 갱신되도록 pending 표시
      ...(durationResyncNeeded ? { googleCalendarStatus: "pending" as const } : {}),
    };
    changedSessions.push(updated);
    return updated;
  });

  return { nextSessions, changedSessions, changed };
}

async function resolveStudentAndSessions(args: {
  token: string;
  students?: Student[];
  sessions?: Session[];
}): Promise<{ student: Student | null; sessions: Session[] }> {
  let students =
    Array.isArray(args.students) && args.students.length > 0
      ? args.students
      : readLocalStudents();
  let sessions =
    Array.isArray(args.sessions) && args.sessions.length > 0
      ? args.sessions
      : readLocalSessions();

  let student = findStudentByTokenInRows(args.token, students);
  const hasOwnSessions = Boolean(
    student && sessions.some((s) => s.studentId === student!.id && !s.id.startsWith("virtual_"))
  );

  if (!student || !hasOwnSessions) {
    const snapshot = await readSnapshotServerFirst();
    students = snapshot.students;
    sessions = snapshot.sessions;
    student = findStudentByTokenInRows(args.token, students);
  }

  return { student, sessions };
}

export type SaveSessionAdjustmentResult = {
  ok: boolean;
  meta: SessionMeta;
};

/**
 * 개별 회차 조정(출결/변경/이월/수업길이)을 단 1회 부분 병합 저장(POST /api/snapshot)으로 통합 처리합니다.
 * - 변경된 학생의 바뀐 세션만 sessionsMergeMode="merge"로 전송하여 동시 수정 덮어쓰기(Lost Update)를 원천 차단
 * - 서버 저장 실패 시 로컬 metaMap을 안전하게 원상복구(롤백)하고 { ok: false } 반환
 * - 날짜/시작시각은 같고 수업시간(overrideDurationMin)만 바뀌어도 구글 캘린더 종료 시간 동기화를 트리거
 */
export async function saveSessionAdjustmentByToken(args: {
  token: string;
  index: number;
  patch: Partial<SessionMeta>;
  students?: Student[];
  sessions?: Session[];
}): Promise<SaveSessionAdjustmentResult> {
  const { token, index, patch } = args;
  const prevMetaMap = readMetaMap(token);
  const prevMeta: SessionMeta = prevMetaMap[index] ?? {};
  const { key, raw, nextMetaMap, nextMeta } = buildUpdatedMetaMap(token, index, patch);

  const previousRaw = typeof window !== "undefined" ? browserStorage.getItem(key) : null;
  const rollbackLocalMeta = () => {
    if (typeof window === "undefined") return;
    if (previousRaw !== null) {
      browserStorage.setItemSilent(key, previousRaw);
    } else {
      browserStorage.removeItemSilent(key);
    }
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
  };

  if (typeof window !== "undefined") {
    browserStorage.setItemSilent(key, raw);
    window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
  }

  if (!token) return { ok: true, meta: nextMeta };

  const durationChanged =
    (prevMeta.overrideDurationMin ?? null) !== (nextMeta.overrideDurationMin ?? null);

  const { student, sessions: sourceSessions } = await resolveStudentAndSessions({
    token,
    students: args.students,
    sessions: args.sessions,
  });

  const { nextSessions, changedSessions, changed: sessionsChanged } = student
    ? computeNextSessionsForStudent({
        token,
        student,
        sessions: sourceSessions,
        metaMap: nextMetaMap,
        forceResyncIndex: durationChanged ? index : null,
      })
    : { nextSessions: sourceSessions, changedSessions: [], changed: false };

  try {
    const result = await pushSharedSnapshot({
      stateKv: {
        [key]: raw,
      },
      ...(sessionsChanged
        ? {
            sessions: changedSessions,
            sessionsMergeMode: "merge" as const,
          }
        : {}),
    });

    const syncedOk = result.stateKvSynced && (!sessionsChanged || result.sessionsSynced);
    if (!syncedOk) {
      rollbackLocalMeta();
      return { ok: false, meta: prevMeta };
    }

    if (sessionsChanged) {
      saveSessions(nextSessions, {
        skipSharedSnapshot: true,
        previousOverride: sourceSessions,
      });
    }

    return { ok: true, meta: nextMeta };
  } catch (err) {
    console.error("회차 조정 통합 서버 저장 실패:", err);
    rollbackLocalMeta();
    return { ok: false, meta: prevMeta };
  }
}

export async function syncSessionDisplayAtByToken(token: string): Promise<void> {
  if (!token) return;

  const { student, sessions: sourceSessions } = await resolveStudentAndSessions({ token });
  if (!student) return;

  const metaMap = readMetaMap(token);
  const { nextSessions, changedSessions, changed } = computeNextSessionsForStudent({
    token,
    student,
    sessions: sourceSessions,
    metaMap,
  });

  if (!changed) return;
  try {
    const result = await pushSharedSnapshot({
      sessions: changedSessions,
      sessionsMergeMode: "merge",
    });
    if (result.sessionsSynced) {
      saveSessions(nextSessions, {
        skipSharedSnapshot: true,
        previousOverride: sourceSessions,
      });
    }
  } catch (err) {
    console.error("회차 날짜 동기화 서버 저장 실패:", err);
  }
}
