"use client";

import { useEffect, useMemo, useState } from "react";
import { TEACHERS_EVENT } from "@/lib/storage/teachers";
import { readRosterServerFirst } from "@/lib/storage/serverRead";
import type { StudentStatusKind } from "@/lib/factories/studentStatusFactory";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import type { Student, Teacher } from "@/lib/types/index";
import { formatPhone } from "@/lib/utils/phone";

export type AdminStudentCard = {
  id: string;
  token: string;
  teacherId?: string | null;
  name: string;
  teacherName: string;
  studentPhone: string;
  parentPhone: string;
  status: StudentStatusKind;
};

function teacherNameOf(teachers: Teacher[], teacherId?: string | null) {
  if (!teacherId) return "(미배정)";
  return teachers.find((t) => t.id === teacherId)?.name ?? "(미배정)";
}

function fallbackStatusOfStudent(student: Student): StudentStatusKind {
  if (student.status === "paused") return "paused";
  if (student.status === "active") return "active";
  return "new";
}

type UseAdminStudentsPageDataResult = {
  activeCards: AdminStudentCard[];
  pausedCards: AdminStudentCard[];
};

export function useAdminStudentsPageData(): UseAdminStudentsPageDataResult {
  const { metricsMap } = useStudentRegistry();
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      const next = await readRosterServerFirst();
      if (cancelled) return;
      setStudents(next.students);
      setTeachers(next.teachers);
    };

    void refresh();
    const id = setTimeout(() => setMounted(true), 0);
    const requestRefresh = () => {
      void refresh();
    };
    window.addEventListener("tutorweb:studentsUpdated", requestRefresh);
    window.addEventListener(TEACHERS_EVENT, requestRefresh);
    return () => {
      cancelled = true;
      clearTimeout(id);
      window.removeEventListener("tutorweb:studentsUpdated", requestRefresh);
      window.removeEventListener(TEACHERS_EVENT, requestRefresh);
    };
  }, []);

  const cards = useMemo<AdminStudentCard[]>(() => {
    if (!mounted) return [];
    return students
      .filter((s) => !!s.token)
      .map((s) => ({
        id: s.id,
        token: s.token,
        teacherId: s.teacherId ?? null,
        name: s.name ?? "-",
        teacherName: teacherNameOf(teachers, s.teacherId),
        studentPhone: formatPhone(s.studentPhone),
        parentPhone: formatPhone(s.parentPhone),
        status: metricsMap.get(s.id)?.status ?? fallbackStatusOfStudent(s),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [mounted, students, teachers, metricsMap]);

  const activeCards = useMemo(
    () => cards.filter((c) => c.status !== "paused" && c.status !== "overdue_extension"),
    [cards]
  );
  const pausedCards = useMemo(
    () => cards.filter((c) => c.status === "paused" || c.status === "overdue_extension"),
    [cards]
  );

  return {
    activeCards,
    pausedCards,
  };
}
