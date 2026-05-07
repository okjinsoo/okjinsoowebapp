"use client";

import { useEffect, useMemo, useState } from "react";
import { TEACHERS_EVENT } from "@/lib/storage/teachers";
import { readSnapshotServerFirst } from "@/lib/storage/serverRead";
import {
  buildBaseDatesISO,
  computeEffectiveISO,
  readMetaMap,
} from "@/lib/factories/sessionFactories";
import {
  computePauseLifecycle,
  computeStudentStatusFromMetrics,
} from "@/lib/factories/studentStatusFactory";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { todayYmdKST, kstDateMs, ymdFromISO_KST } from "@/lib/utils/date";
import type { Student, Teacher, Session } from "@/lib/types/index";
import type { StudentStatusKind } from "@/lib/factories/studentStatusFactory";
import { SessionMeta } from "@/lib/ui/session/sessionEffective";

export type EnhancedSession = Session & {
  effectiveISO: string | null;
  meta: SessionMeta;
};

export type StudentMetrics = {
  student: Student;
  teacher: Teacher | null;
  status: StudentStatusKind;
  passedCount: number;
  remainingCount: number;
  totalCount: number;
  lastSessionISO: string | null;
  overdueDays: number;
  pauseLifecycle: ReturnType<typeof computePauseLifecycle>;
  lastClassIndex: number | null;
  sessions: EnhancedSession[];
};

export function useStudentRegistry() {
  const [tick, setTick] = useState(0);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refreshSnapshot = async () => {
      const next = await readSnapshotServerFirst();
      if (cancelled) return;
      setStudents(next.students);
      setTeachers(next.teachers);
      setAllSessions(next.sessions);
    };

    const requestSnapshotRefresh = () => {
      void refreshSnapshot();
    };
    const bumpTick = () => {
      setTick((t) => t + 1);
    };

    void refreshSnapshot();
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, requestSnapshotRefresh);
    window.addEventListener(TEACHERS_EVENT, requestSnapshotRefresh);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, requestSnapshotRefresh);
    window.addEventListener(TUTORWEB_EVENTS.metaMapUpdated, bumpTick);

    return () => {
      cancelled = true;
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, requestSnapshotRefresh);
      window.removeEventListener(TEACHERS_EVENT, requestSnapshotRefresh);
      window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, requestSnapshotRefresh);
      window.removeEventListener(TUTORWEB_EVENTS.metaMapUpdated, bumpTick);
    };
  }, []);

  const registry = useMemo(() => {
    const today = todayYmdKST();
    const todayMs = kstDateMs(today);
    const metricsMap = new Map<string, StudentMetrics>();
    const teachersById = new Map(teachers.map((teacher) => [teacher.id, teacher]));
    const sessionsByStudentId = new Map<string, Session[]>();

    for (const session of allSessions) {
      const bucket = sessionsByStudentId.get(session.studentId);
      if (bucket) bucket.push(session);
      else sessionsByStudentId.set(session.studentId, [session]);
    }

    for (const bucket of sessionsByStudentId.values()) {
      bucket.sort((a, b) => a.index - b.index);
    }

    for (const st of students) {
      if (!st.token) continue;
      
      const teacher = st.teacherId ? teachersById.get(st.teacherId) ?? null : null;
      const realSessions = sessionsByStudentId.get(st.id) ?? [];
      const planCount = st.planCount || 12;
      const sessionsByIndex = new Map(realSessions.map((session) => [session.index, session]));
      const rawSessions: Session[] = [];
      for (let i = 1; i <= planCount; i += 1) {
        const existing = sessionsByIndex.get(i);
        if (existing) {
          rawSessions.push(existing);
          continue;
        }
        rawSessions.push({
          id: `virtual_${st.id}_${i}`,
          studentId: st.id,
          index: i,
          displayAt: "",
          state: "normal",
        });
      }
      const baseDatesISO = buildBaseDatesISO(st, 60);
      const metaMap = readMetaMap(st.token);

      let passedCount = 0;
      let lastSessionISO: string | null = null;
      const enhancedSessions: EnhancedSession[] = [];

      for (const s of rawSessions) {
        const { effectiveISO, meta } = computeEffectiveISO({
          token: st.token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });
        
        enhancedSessions.push({ ...s, effectiveISO, meta });

        if (!effectiveISO) continue;
        const ymd = ymdFromISO_KST(effectiveISO);
        if (ymd && ymd < today) passedCount += 1;
        if (!lastSessionISO || effectiveISO > lastSessionISO) lastSessionISO = effectiveISO;
      }

      const totalCount = Math.max(0, st.planCount ?? 0, rawSessions.length);
      const remainingCount = Math.max(0, totalCount - passedCount);
      const finishedAll = totalCount > 0 && passedCount >= totalCount;
      const lastYmd = lastSessionISO ? ymdFromISO_KST(lastSessionISO) ?? "" : "";
      const lastMs = lastYmd ? kstDateMs(lastYmd) : null;
      const overdueDays = finishedAll && todayMs !== null && lastMs !== null
        ? Math.floor((todayMs - lastMs) / 86400000)
        : 0;

      // 휴회 정책 제거: 상태 계산에서 휴회 입력값은 더 이상 사용하지 않는다.
      const pauseLifecycle = computePauseLifecycle(today, undefined);
      const status = computeStudentStatusFromMetrics({
        pauseLifecycle,
        hasPendingPauseRequest: false,
        overdueDays,
        remainingCount,
        passedCount,
      });

      const lastClassIndex = null;

      metricsMap.set(st.id, {
        student: st,
        teacher,
        status,
        passedCount,
        remainingCount,
        totalCount,
        lastSessionISO,
        overdueDays,
        pauseLifecycle,
        lastClassIndex,
        sessions: enhancedSessions,
      });
    }

    return {
      students,
      teachers,
      metricsMap,
      tick,
    };
  }, [students, teachers, allSessions, tick]);

  return registry;
}
