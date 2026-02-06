// lib/storage/teachers.ts
// A안: 선생님(Teacher) 목록을 localStorage 에 저장합니다.
import type { Teacher } from "@/lib/types/index";

const KEY = "tutorweb_teachers_v1";

const LS_CURRENT_TEACHER = "tutorweb_current_teacherId_v1";
export const TEACHERS_EVENT = "tutorweb:teachersUpdated";

function dispatchTeachersUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TEACHERS_EVENT));
}

export function loadCurrentTeacherId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(LS_CURRENT_TEACHER);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

export function saveCurrentTeacherId(id: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_CURRENT_TEACHER, id);
  } catch {}
}

export function clearCurrentTeacherId() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(LS_CURRENT_TEACHER);
  } catch {}
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function loadTeachers(): Teacher[] {
  if (typeof window === "undefined") return [];
  return safeParse<Teacher[]>(localStorage.getItem(KEY), []);
}

export function saveTeachers(list: Teacher[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(list));
  dispatchTeachersUpdated();
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
  saveTeachers(list);
  return list;
}

export function findTeacherById(teacherId: string): Teacher | null {
  return loadTeachers().find((t) => t.id === teacherId) ?? null;
}

export function clearTeachers(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  dispatchTeachersUpdated();
}
