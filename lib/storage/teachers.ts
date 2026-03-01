// lib/storage/teachers.ts
// A안: 선생님(Teacher) 목록을 browserStorage 에 저장합니다.
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { syncRoleBindingEmails } from "@/lib/auth/roleBindings";
import { fetchServerTeachers } from "@/lib/storage/serverRead";
import { pushSharedSnapshot, readLocalStudents } from "@/lib/storage/sharedSnapshot";
import { safeParseJson } from "@/lib/storage/safeParse";
import { requestCalendarResyncForTeacherIds } from "@/lib/storage/sessions";
import { loadLatestCoreSnapshotBaseline, mergeById } from "@/lib/storage/safeSnapshotMerge";
import type { Teacher } from "@/lib/types/index";

const KEY = "tutorweb_teachers_v1";

const LS_CURRENT_TEACHER = "tutorweb_current_teacherId_v1";
export const TEACHERS_EVENT = "tutorweb:teachersUpdated";

type SaveTeachersOptions = {
  skipSharedSnapshot?: boolean;
  snapshotMode?: "merge" | "replace";
};

function dispatchTeachersUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEACHERS_EVENT));
}

export function loadCurrentTeacherId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = browserStorage.getItem(LS_CURRENT_TEACHER);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function saveCurrentTeacherId(id: string) {
  if (typeof window === "undefined") return;
  try {
    browserStorage.setItem(LS_CURRENT_TEACHER, id);
  } catch {}
}

export function clearCurrentTeacherId() {
  if (typeof window === "undefined") return;
  try {
    browserStorage.removeItem(LS_CURRENT_TEACHER);
  } catch {}
}

function extractTeacherEmails(list: Teacher[]): string[] {
  return list
    .map((teacher) => (teacher.email ?? "").trim())
    .filter((email) => Boolean(email));
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function changedTeacherEmailIds(previous: Teacher[], next: Teacher[]): string[] {
  const prevById = new Map(previous.map((teacher) => [teacher.id, normalizeEmail(teacher.email)] as const));
  const out: string[] = [];
  for (const teacher of next) {
    const prevEmail = prevById.get(teacher.id);
    if (prevEmail === undefined) continue;
    const nextEmail = normalizeEmail(teacher.email);
    if (prevEmail === nextEmail) continue;
    out.push(teacher.id);
  }
  return out;
}

function syncTeacherRoleBindings(previous: Teacher[], next: Teacher[]): void {
  void syncRoleBindingEmails({
    previousEmails: extractTeacherEmails(previous),
    nextEmails: extractTeacherEmails(next),
    role: "teacher",
  }).catch((err) => {
    console.error("선생님 권한 동기화 실패:", err);
  });
}

function syncSharedSnapshot(nextTeachers: Teacher[], mode: "merge" | "replace"): void {
  void (async () => {
    const baseline = await loadLatestCoreSnapshotBaseline();
    const mergedTeachers = mode === "replace"
      ? nextTeachers
      : mergeById(baseline.teachers, nextTeachers);

    await pushSharedSnapshot({
      teachers: mergedTeachers,
      students: baseline.students.length > 0 ? baseline.students : readLocalStudents(),
    });
  })().catch((err) => {
    console.error("공유 스냅샷 동기화 실패(teachers):", err);
  });
}

export function loadTeachers(): Teacher[] {
  if (typeof window === "undefined") return [];
  return safeParseJson<Teacher[]>(browserStorage.getItem(KEY), []);
}

function replaceTeachersLocal(list: Teacher[]): boolean {
  if (typeof window === "undefined") return false;
  const nextRaw = JSON.stringify(list);
  if (browserStorage.getItem(KEY) === nextRaw) return false;
  browserStorage.setItem(KEY, nextRaw);
  dispatchTeachersUpdated();
  return true;
}

export async function hydrateTeachersFromServer(): Promise<Teacher[]> {
  const remote = await fetchServerTeachers();
  if (!remote) return loadTeachers();
  replaceTeachersLocal(remote);
  return remote;
}

export function saveTeachers(list: Teacher[], options?: SaveTeachersOptions): void {
  if (typeof window === "undefined") return;
  const previous = loadTeachers();
  const changedEmailIds = changedTeacherEmailIds(previous, list);
  browserStorage.setItem(KEY, JSON.stringify(list));
  dispatchTeachersUpdated();
  syncTeacherRoleBindings(previous, list);
  if (!options?.skipSharedSnapshot) {
    syncSharedSnapshot(list, options?.snapshotMode ?? "merge");
  }
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForTeacherIds(changedEmailIds);
  }
}

export async function saveTeachersServerFirst(list: Teacher[]): Promise<void> {
  await pushSharedSnapshot({
    teachers: list,
    students: readLocalStudents(),
  });
  saveTeachers(list, { skipSharedSnapshot: true });
}

export function upsertTeacher(t: Teacher): Teacher[] {
  const list = loadTeachers();
  const idx = list.findIndex((x) => x.id === t.id);
  if (idx >= 0) list[idx] = t;
  else list.push(t);
  saveTeachers(list);
  return list;
}

export function removeTeacher(teacherId: string): Teacher[] {
  const list = loadTeachers().filter((t) => t.id !== teacherId);
  saveTeachers(list, { snapshotMode: "replace" });
  return list;
}

export function findTeacherById(teacherId: string): Teacher | null {
  return loadTeachers().find((t) => t.id === teacherId) ?? null;
}

export function clearTeachers(): void {
  if (typeof window === "undefined") return;
  const previous = loadTeachers();
  browserStorage.removeItem(KEY);
  dispatchTeachersUpdated();
  syncTeacherRoleBindings(previous, []);
  syncSharedSnapshot([], "replace");
}
