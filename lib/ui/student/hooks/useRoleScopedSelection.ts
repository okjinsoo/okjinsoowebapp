"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AUTH_EVENT } from "@/lib/auth/supabaseAuth";
import { resolveSelectionForRole } from "@/lib/auth/loginSelection";
import {
  clearCurrentTeacherId,
  loadCurrentTeacherId,
  saveCurrentTeacherId,
  TEACHERS_EVENT,
} from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";
import {
  clearCurrentStudentToken,
  GATE_EVENT,
  loadCurrentStudentToken,
  saveCurrentStudentToken,
} from "@/lib/ui/common/roleGateStorage";
import { readRosterServerFirst } from "@/lib/storage/serverRead";

type Role = "a" | "t" | "s";

type UseRoleScopedSelectionArgs = {
  role: Role;
  preferredStudentToken?: string | null;
};

type ApplyPreferredTokenArgs = {
  preferredStudentToken: string;
  students: Student[];
};

function applyPreferredStudentToken(args: ApplyPreferredTokenArgs): {
  applied: boolean;
  studentToken: string | null;
  teacherId: string | null;
} {
  const nextToken = args.preferredStudentToken.trim();
  if (!nextToken) {
    return {
      applied: false,
      studentToken: null,
      teacherId: null,
    };
  }

  const matchedStudent = args.students.find((student) => student.token === nextToken);
  if (!matchedStudent?.token) {
    return {
      applied: false,
      studentToken: null,
      teacherId: null,
    };
  }

  return {
    applied: true,
    studentToken: matchedStudent.token,
    teacherId: matchedStudent.teacherId ?? null,
  };
}

export default function useRoleScopedSelection(args: UseRoleScopedSelectionArgs) {
  const { role, preferredStudentToken = null } = args;

  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [studentToken, setStudentToken] = useState<string | null>(null);
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const applySelection = useCallback((nextStudents: Student[], nextTeachers: Teacher[]) => {
    const preferred = (preferredStudentToken ?? "").trim();
    if (preferred) {
      const preferredSelection = applyPreferredStudentToken({
        preferredStudentToken: preferred,
        students: nextStudents,
      });
      if (preferredSelection.applied) {
        setStudentToken(preferredSelection.studentToken);
        setTeacherId(preferredSelection.teacherId);

        if (preferredSelection.studentToken) saveCurrentStudentToken(preferredSelection.studentToken);
        else clearCurrentStudentToken();

        if (preferredSelection.teacherId) saveCurrentTeacherId(preferredSelection.teacherId);
        else clearCurrentTeacherId();
        return;
      }
    }

    const selection = resolveSelectionForRole({
      role,
      teachers: nextTeachers,
      students: nextStudents,
      savedTeacherId: loadCurrentTeacherId(),
      savedStudentToken: loadCurrentStudentToken(),
    });

    setStudentToken(selection.studentToken);
    setTeacherId(selection.teacherId);

    if (selection.studentToken) saveCurrentStudentToken(selection.studentToken);
    else clearCurrentStudentToken();

    if (selection.teacherId) saveCurrentTeacherId(selection.teacherId);
    else clearCurrentTeacherId();
  }, [preferredStudentToken, role]);

  const refreshRoster = useCallback(async () => {
    const next = await readRosterServerFirst();
    setStudents(next.students);
    setTeachers(next.teachers);
    applySelection(next.students, next.teachers);
    setHydrated(true);
  }, [applySelection]);

  useEffect(() => {
    let cancelled = false;

    const requestRefresh = async () => {
      const next = await readRosterServerFirst();
      if (cancelled) return;
      setStudents(next.students);
      setTeachers(next.teachers);
      applySelection(next.students, next.teachers);
      setHydrated(true);
    };

    const onRefresh = () => {
      void requestRefresh();
    };

    void requestRefresh();

    window.addEventListener(GATE_EVENT, onRefresh);
    window.addEventListener(AUTH_EVENT, onRefresh);
    window.addEventListener("tutorweb:studentsUpdated", onRefresh);
    window.addEventListener(TEACHERS_EVENT, onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(GATE_EVENT, onRefresh);
      window.removeEventListener(AUTH_EVENT, onRefresh);
      window.removeEventListener("tutorweb:studentsUpdated", onRefresh);
      window.removeEventListener(TEACHERS_EVENT, onRefresh);
    };
  }, [applySelection]);

  const state = useMemo(() => {
    return {
      students,
      teachers,
      studentToken,
      teacherId,
      hydrated,
    };
  }, [students, teachers, studentToken, teacherId, hydrated]);

  return {
    ...state,
    setStudentToken,
    setTeacherId,
    refreshRoster,
  };
}
