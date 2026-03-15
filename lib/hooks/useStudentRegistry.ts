"use client";

import { useEffect, useMemo, useState } from "react";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers, TEACHERS_EVENT } from "@/lib/storage/teachers";
import { loadSessions, sessionsByStudent } from "@/lib/storage/sessions";
import { loadConsultationsByStudent } from "@/lib/storage/consultations";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  readMetaMap,
} from "@/lib/factories/sessionFactories";
import {
  computePauseLifecycle,
  computeStudentStatusFromMetrics,
} from "@/lib/factories/studentStatusFactory";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { todayYmdKST, kstDateMs, ymdFromISO_KST } from "@/lib/utils/date";
import type { Student, Teacher, Session, ConsultationRecord } from "@/lib/types/index";
import type { StudentStatusKind } from "@/lib/factories/studentStatusFactory";

export type EnhancedSession = Session & {
  effectiveISO: string | null;
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
  latestPauseRequest: ConsultationRecord | null;
  consultIndex: number | null;
  sessions: EnhancedSession[];
};

export function useStudentRegistry() {
  const [tick, setTick] = useState(0);
  const [students, setStudents] = useState<Student[]>(() => loadStudents());
  const [teachers, setTeachers] = useState<Teacher[]>(() => loadTeachers());

  useEffect(() => {
    const refresh = () => {
      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setTick((t) => t + 1);
    };

    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, refresh);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, refresh);
    window.addEventListener(TUTORWEB_EVENTS.consultationsUpdated, refresh);
    window.addEventListener(TUTORWEB_EVENTS.metaMapUpdated, refresh);
    window.addEventListener(TEACHERS_EVENT, refresh);

    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, refresh);
      window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, refresh);
      window.removeEventListener(TUTORWEB_EVENTS.consultationsUpdated, refresh);
      window.removeEventListener(TUTORWEB_EVENTS.metaMapUpdated, refresh);
      window.removeEventListener(TEACHERS_EVENT, refresh);
    };
  }, []);

  const registry = useMemo(() => {
    const today = todayYmdKST();
    const todayMs = kstDateMs(today);
    const metricsMap = new Map<string, StudentMetrics>();

    for (const st of students) {
      if (!st.token) continue;
      
      const teacher = teachers.find((t) => t.id === st.teacherId) ?? null;
      const rawSessions = sessionsByStudent(st.id);
      const baseDatesISO = buildBaseDatesISOByToken(st.token, 60);
      const metaMap = readMetaMap(st.token);
      const consultations = loadConsultationsByStudent(st.id);

      let passedCount = 0;
      let lastSessionISO: string | null = null;
      const enhancedSessions: EnhancedSession[] = [];

      for (const s of rawSessions) {
        const { effectiveISO } = computeEffectiveISO({
          token: st.token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });
        
        enhancedSessions.push({ ...s, effectiveISO });

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

      const latestPauseRequest = [...consultations]
        .filter((r) => r.purpose === "pause_request")
        .sort((a, b) => {
          const ad = `${a.date ?? ""}|${a.createdAt ?? ""}`;
          const bd = `${b.date ?? ""}|${b.createdAt ?? ""}`;
          return ad.localeCompare(bd);
        })
        .at(-1) ?? null;

      // consultIndex 계산 로직 (기존 AdminMainPage 로직 이관)
      let consultIndex: number | null = null;
      if (latestPauseRequest?.date) {
        const entries = enhancedSessions
          .filter(e => e.effectiveISO)
          .map(e => ({ index: e.index, ms: new Date(e.effectiveISO!).getTime(), ymd: ymdFromISO_KST(e.effectiveISO!) ?? "" }));
        
        if (entries.length > 0) {
          const same = entries.filter(e => e.ymd === latestPauseRequest.date).sort((a, b) => a.index - b.index);
          if (same.length > 0) consultIndex = same[0].index;
          else {
            const targetMs = new Date(`${latestPauseRequest.date}T00:00:00+09:00`).getTime();
            const future = entries.filter(e => e.ms >= targetMs).sort((a, b) => a.ms - b.ms);
            if (future.length > 0) consultIndex = future[0].index;
            else {
              const past = entries.filter(e => e.ms < targetMs).sort((a, b) => b.ms - a.ms);
              if (past.length > 0) consultIndex = past[0].index;
            }
          }
        }
      }

      const pauseLifecycle = computePauseLifecycle(today, st.pauseEffectiveDate);
      const status = computeStudentStatusFromMetrics({
        pauseLifecycle,
        hasPendingPauseRequest: Boolean(latestPauseRequest && !latestPauseRequest.finalResult),
        overdueDays,
        remainingCount,
        passedCount,
      });

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
        latestPauseRequest,
        consultIndex,
        sessions: enhancedSessions,
      });
    }

    return {
      students,
      teachers,
      metricsMap,
      tick,
    };
  }, [students, teachers, tick]);

  return registry;
}
