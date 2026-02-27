// lib/storage/students.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { syncRoleBindingEmails } from "@/lib/auth/roleBindings";
import { pushSharedSnapshot, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import { requestCalendarResyncForStudentIds } from "@/lib/storage/sessions";
import type { Student, StudentStatus } from "@/lib/types/index";

const KEY = "tutorweb_students_v1";

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function extractStudentEmails(list: Student[]): string[] {
  return list
    .map((student) => (student.googleEmail ?? "").trim())
    .filter((email) => Boolean(email));
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function changedStudentEmailIds(previous: Student[], next: Student[]): string[] {
  const prevById = new Map(previous.map((student) => [student.id, normalizeEmail(student.googleEmail)] as const));
  const out: string[] = [];
  for (const student of next) {
    const prevEmail = prevById.get(student.id);
    if (prevEmail === undefined) continue;
    const nextEmail = normalizeEmail(student.googleEmail);
    if (prevEmail === nextEmail) continue;
    out.push(student.id);
  }
  return out;
}

function syncStudentRoleBindings(previous: Student[], next: Student[]): void {
  void syncRoleBindingEmails({
    previousEmails: extractStudentEmails(previous),
    nextEmails: extractStudentEmails(next),
    role: "student",
  }).catch((err) => {
    console.error("학생 권한 동기화 실패:", err);
  });
}

function syncSharedSnapshot(nextStudents: Student[]): void {
  void pushSharedSnapshot({
    teachers: readLocalTeachers(),
    students: nextStudents,
  }).catch((err) => {
    console.error("공유 스냅샷 동기화 실패(students):", err);
  });
}

export function loadStudents(): Student[] {
  if (typeof window === "undefined") return [];
  return safeParse<Student[]>(browserStorage.getItem(KEY), []);
}

export function saveStudents(list: Student[]): void {
  if (typeof window === "undefined") return;
  const previous = loadStudents();
  const changedEmailIds = changedStudentEmailIds(previous, list);
  browserStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("tutorweb:studentsUpdated"));
  syncStudentRoleBindings(previous, list);
  syncSharedSnapshot(list);
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForStudentIds(changedEmailIds);
  }
}

export function upsertStudent(student: Student): Student[] {
  const list = loadStudents();
  const idx = list.findIndex((s) => s.id === student.id);
  if (idx >= 0) list[idx] = student;
  else list.push(student);
  saveStudents(list);
  return list;
}

export function removeStudent(studentId: string): Student[] {
  const list = loadStudents().filter((s) => s.id !== studentId);
  saveStudents(list);
  return list;
}

export function setStudentStatus(studentId: string, status: StudentStatus): Student[] {
  const list = loadStudents().map((s) => (s.id === studentId ? { ...s, status } : s));
  saveStudents(list);
  return list;
}

/** 링크용 token으로 학생 찾기 */
export function findStudentByToken(token: string): Student | null {
  const list = loadStudents();
  return list.find((s) => s.token === token) ?? null;
}

/** (선택) 디버그용: 스토리지 초기화 */
export function clearStudents(): void {
  if (typeof window === "undefined") return;
  const previous = loadStudents();
  browserStorage.removeItem(KEY);
  syncStudentRoleBindings(previous, []);
  syncSharedSnapshot([]);
}
