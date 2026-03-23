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

function hasDriveFolder(student: Student): boolean {
  return Boolean((student.driveFolderId ?? "").trim());
}

function pickBestStudentByEmail(args: {
  students: Student[];
  email: string;
  preferredToken?: string | null;
}): Student | null {
  const matched = args.students.filter((student) => normalizeEmail(student.googleEmail) === args.email);
  if (matched.length === 0) return null;

  if (args.preferredToken) {
    const preferred = matched.find((student) => student.token === args.preferredToken);
    if (preferred) return preferred;
  }

  const activeWithLocker = matched.find((student) => student.status === "active" && hasDriveFolder(student));
  if (activeWithLocker) return activeWithLocker;

  const withLocker = matched.find((student) => hasDriveFolder(student));
  if (withLocker) return withLocker;

  const active = matched.find((student) => student.status === "active");
  return active ?? matched[0] ?? null;
}

export function findTeacherByLoginEmail(teachers: Teacher[]): Teacher | null {
  const email = loginEmail();
  if (!email) return null;
  return teachers.find((teacher) => normalizeEmail(teacher.email) === email) ?? null;
}

export function findStudentByLoginEmail(students: Student[]): Student | null {
  const email = loginEmail();
  if (!email) return null;
  return pickBestStudentByEmail({ students, email });
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
    const email = loginEmail();
    const matchedStudent = email
      ? pickBestStudentByEmail({
          students,
          email,
          preferredToken: savedStudentToken,
        })
      : null;
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
    const savedTeacher = savedTeacherId
      ? teachers.find((teacher) => teacher.id === savedTeacherId)
      : null;
    const activeTeacher = matchedTeacher ?? savedTeacher;

    if (!activeTeacher) {
      return {
        teacherId: null,
        studentToken: null,
      };
    }

    return {
      teacherId: activeTeacher.id,
      studentToken: pickTeacherStudentToken({
        students,
        teacherId: activeTeacher.id,
        preferredToken: savedStudentToken,
      }),
    };
  }

  return {
    teacherId: savedTeacherId,
    studentToken: savedStudentToken,
  };
}
