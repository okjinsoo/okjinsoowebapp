// v1/lib/factories/sessionDisplaySync.ts
// 회차 displayAt/캘린더 pending 변경분 순수 계산 엔진 (브라우저 저장소·UI 의존 없음)

import {
  buildBaseDatesISOFromMetaMap,
  computeEffectiveISO,
} from "@/lib/factories/sessionEffectiveCore";
import type { Session, SessionMeta, Student } from "@/lib/types/index";

export function computeNextSessionsForStudent(args: {
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
  const baseDatesISO = buildBaseDatesISOFromMetaMap(
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
