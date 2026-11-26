// lib/integrations/rosterCalendarActions.ts
"use client";

/**
 * 학생/선생님 명단 저장 + 이메일 변경 시 구글 Meet 재동기화
 *
 * 쉽게 말해:
 * - lib/storage/students.ts, teachers.ts 는 명단을 "적기만" 하고, 이메일이 바뀐 사람 목록을 알려줍니다.
 * - 이 파일은 그 목록을 받아 "그 사람들 회차를 캘린더에서 다시 맞춰 주세요"라고 요청합니다.
 *
 * 예전 `saveStudents()` / `saveTeachers()`의 기본 동작과 똑같습니다.
 */

import {
  requestCalendarResyncForStudentIds,
  requestCalendarResyncForTeacherIds,
} from "@/lib/integrations/sessionCalendarActions";
import { saveStudents, saveStudentsServerFirst } from "@/lib/storage/students";
import { saveTeachers, saveTeachersServerFirst } from "@/lib/storage/teachers";
import type { Student, Teacher } from "@/lib/types/index";

export function saveStudentsAndResyncCalendar(
  list: Student[],
  options?: Parameters<typeof saveStudents>[1]
): void {
  const changedEmailIds = saveStudents(list, options);
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForStudentIds(changedEmailIds);
  }
}

export async function saveStudentsServerFirstAndResyncCalendar(list: Student[]): Promise<void> {
  const changedEmailIds = await saveStudentsServerFirst(list);
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForStudentIds(changedEmailIds);
  }
}

export function saveTeachersAndResyncCalendar(
  list: Teacher[],
  options?: Parameters<typeof saveTeachers>[1]
): void {
  const changedEmailIds = saveTeachers(list, options);
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForTeacherIds(changedEmailIds);
  }
}

export async function saveTeachersServerFirstAndResyncCalendar(list: Teacher[]): Promise<void> {
  const changedEmailIds = await saveTeachersServerFirst(list);
  if (changedEmailIds.length > 0) {
    requestCalendarResyncForTeacherIds(changedEmailIds);
  }
}
