"use client";

import { loadAuthSession } from "@/lib/auth/supabaseAuth";
import type { Student, Teacher } from "@/lib/types/index";

type Role = "a" | "t" | "s";

export type ResolvedSelection = {
  teacherId: string | null;
  studentToken: string | null;
};

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function loginEmail(): string {
  return normalizeEmail(loadAuthSession()?.email);
}

export function findTeacherByLoginEmail(teachers: Teacher[]): Teacher | null {
  const email = loginEmail();
  if (!email) return null;
  return teachers.find((teacher) => normalizeEmail(teacher.email) === email) ?? null;
}

export function findStudentByLoginEmail(students: Student[]): Student | null {
  const email = loginEmail();
  if (!email) return null;
  return students.find((student) => normalizeEmail(student.googleEmail) === email) ?? null;
}

function pickTeacherStudentToken(args: {
  students: Student[];
  teacherId: string;
  preferredToken: string | null;
}): string | null {
  const assigned = args.students.filter((student) => (student.teacherId ?? null) === args.teacherId);
  if (assigned.length === 0) return null;

  if (args.preferredToken) {
    const matched = assigned.find((student) => student.token === args.preferredToken);
    if (matched) return matched.token;
  }
  return assigned[0]?.token ?? null;
}

export function resolveSelectionForRole(args: {
  role: Role;
  teachers: Teacher[];
  students: Student[];
  savedTeacherId: string | null;
  savedStudentToken: string | null;
}): ResolvedSelection {
  const { role, teachers, students, savedTeacherId, savedStudentToken } = args;

  if (role === "s") {
    const matchedStudent = findStudentByLoginEmail(students);
    if (matchedStudent) {
      return {
        teacherId: matchedStudent.teacherId ?? null,
        studentToken: matchedStudent.token ?? null,
      };
    }

    const savedStudent = savedStudentToken
      ? students.find((student) => student.token === savedStudentToken)
      : null;
    return {
      teacherId: savedStudent?.teacherId ?? null,
      studentToken: savedStudent?.token ?? null,
    };
  }

  if (role === "t") {
    const matchedTeacher = findTeacherByLoginEmail(teachers);
    if (!matchedTeacher) {
      return {
        teacherId: null,
        studentToken: null,
      };
    }

    return {
      teacherId: matchedTeacher.id,
      studentToken: pickTeacherStudentToken({
        students,
        teacherId: matchedTeacher.id,
        preferredToken: savedStudentToken,
      }),
    };
  }

  return {
    teacherId: savedTeacherId,
    studentToken: savedStudentToken,
  };
}
