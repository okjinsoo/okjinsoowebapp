// lib/storage/students.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { syncRoleBindingEmails } from "@/lib/auth/roleBindings";
import { fetchServerStudents } from "@/lib/storage/serverRead";
import { pushSharedSnapshot, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import { requestCalendarResyncForStudentIds } from "@/lib/storage/sessions";
import { safeParseJson } from "@/lib/storage/safeParse";
import { loadLatestCoreSnapshotBaseline, mergeById } from "@/lib/storage/safeSnapshotMerge";
import type { Student, StudentStatus } from "@/lib/types/index";

const KEY = "tutorweb_students_v1";

type SaveStudentsOptions = {
  skipSharedSnapshot?: boolean;
  snapshotMode?: "merge" | "replace";
};

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

function syncSharedSnapshot(nextStudents: Student[], mode: "merge" | "replace"): void {
  void (async () => {
    const baseline = await loadLatestCoreSnapshotBaseline();
    const mergedStudents = mode === "replace"
      ? nextStudents
      : mergeById(baseline.students, nextStudents);

    await pushSharedSnapshot({
      teachers: baseline.teachers.length > 0 ? baseline.teachers : readLocalTeachers(),
      students: mergedStudents,
    });
  })().catch((err) => {
    console.error("공유 스냅샷 동기화 실패(students):", err);
  });
}

export function loadStudents(): Student[] {
  if (typeof window === "undefined") return [];
  return safeParseJson<Student[]>(browserStorage.getItem(KEY), []);
}

function dispatchStudentsUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tutorweb:studentsUpdated"));
}

function replaceStudentsLocal(list: Student[]): boolean {
  if (typeof window === "undefined") return false;
  const nextRaw = JSON.stringify(list);
  if (browserStorage.getItem(KEY) === nextRaw) return false;
  browserStorage.setItem(KEY, nextRaw);
  dispatchStudentsUpdated();
  return true;
}

export async function hydrateStudentsFromServer(): Promise<Student[]> {
  const remote = await fetchServerStudents();
  if (!remote) return loadStudents();
  replaceStudentsLocal(remote);
  return remote;
}

export function saveStudents(list: Student[], options?: SaveStudentsOptions): void {
  if (typeof window === "undefined") return;
  const previous = loadStudents();
  const changedEmailIds = changedStudentEmailIds(previous, list);
  browserStorage.setItem(KEY, JSON.stringify(list));
  dispatchStudentsUpdated();
  syncStudentRoleBindings(previous, list);
  if (!options?.skipSharedSnapshot) {
    syncSharedSnapshot(list, options?.snapshotMode ?? "merge");
  }
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForStudentIds(changedEmailIds);
  }
}

export async function saveStudentsServerFirst(list: Student[]): Promise<void> {
  await pushSharedSnapshot({
    teachers: readLocalTeachers(),
    students: list,
  });
  saveStudents(list, { skipSharedSnapshot: true });
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
  saveStudents(list, { snapshotMode: "replace" });
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
  syncSharedSnapshot([], "replace");
}
