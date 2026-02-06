// lib/storage/students.ts
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

export function loadStudents(): Student[] {
  if (typeof window === "undefined") return [];
  return safeParse<Student[]>(localStorage.getItem(KEY), []);
}

export function saveStudents(list: Student[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent("tutorweb:studentsUpdated"));
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
  localStorage.removeItem(KEY);
}
