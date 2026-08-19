"use client";

import { useEffect, useMemo, useState } from "react";
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
  if (student.status === "active") return "active";
  return "new";
}

type UseAdminStudentsPageDataResult = {
  cards: AdminStudentCard[];
};

export function useAdminStudentsPageData(): UseAdminStudentsPageDataResult {
  const { students, teachers, metricsMap } = useStudentRegistry();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
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

  return {
    cards,
  };
}
