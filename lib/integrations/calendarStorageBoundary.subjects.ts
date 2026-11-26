// 임시 어댑터(0단계): 현재 코드의 함수 이름을 테스트용 이름에 연결합니다.
// 리팩토링이 끝나면 이 파일은 지우고 테스트가 새 모듈을 직접 import 합니다.
import type { Session, Student, Teacher } from "@/lib/types/index";
import { saveSessions, requestResetAndResyncMeetForStudentIds } from "@/lib/storage/sessions";
import { saveStudents } from "@/lib/storage/students";
import { saveTeachers } from "@/lib/storage/teachers";

type SessionOpts = Parameters<typeof saveSessions>[1];

export function saveSessionsAndSyncCalendar(list: Session[], options?: SessionOpts): void {
  saveSessions(list, options);
}

export function saveSessionsWithoutCalendar(list: Session[], options?: SessionOpts): void {
  saveSessions(list, { ...options, suppressCalendarSync: true });
}

export function saveStudentsAndResyncCalendar(
  list: Student[],
  options?: Parameters<typeof saveStudents>[1]
): void {
  saveStudents(list, options);
}

export function saveTeachersAndResyncCalendar(
  list: Teacher[],
  options?: Parameters<typeof saveTeachers>[1]
): void {
  saveTeachers(list, options);
}

export { requestResetAndResyncMeetForStudentIds };
