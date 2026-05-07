"use client";

import { useCallback, useEffect, useState } from "react";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { readStudentContextServerFirst } from "@/lib/storage/serverRead";
import type { Session, Student } from "@/lib/types/index";

type StudentContextSnapshot = Awaited<ReturnType<typeof readStudentContextServerFirst>>;

export function useStudentSessionContext(token: string) {
  const [student, setStudent] = useState<Student | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isInitialLoaded, setIsInitialLoaded] = useState(false);

  const applySnapshot = useCallback((next: StudentContextSnapshot) => {
    setStudent(next.student);
    setSessions(next.sessions);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await readStudentContextServerFirst(token);
      applySnapshot(next);
    } catch (error) {
      console.error("학생 컨텍스트 갱신 실패:", error);
    } finally {
      setIsInitialLoaded(true);
    }
  }, [token, applySnapshot]);

  useEffect(() => {
    let cancelled = false;
    setStudent(null);
    setSessions([]);
    setIsInitialLoaded(false);

    const refreshSafely = async () => {
      try {
        const next = await readStudentContextServerFirst(token);
        if (cancelled) return;
        applySnapshot(next);
      } catch (error) {
        console.error("학생 컨텍스트 초기 로드 실패:", error);
        if (cancelled) return;
        setStudent(null);
        setSessions([]);
      } finally {
        if (!cancelled) setIsInitialLoaded(true);
      }
    };

    const requestRefresh = () => {
      void refreshSafely();
    };

    void refreshSafely();
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, requestRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
      window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, requestRefresh);
    };
  }, [token, applySnapshot]);

  return {
    student,
    sessions,
    isInitialLoaded,
    refresh,
    setStudent,
    setSessions,
  };
}
