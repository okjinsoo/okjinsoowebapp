// lib/integrations/sessionCalendarActions.ts
"use client";

/**
 * 회차 ↔ 구글 캘린더/Meet 연결 동작 모음
 *
 * 쉽게 말해:
 * - lib/storage/sessions.ts 는 "공책에 적는 담당"(저장만)
 * - 이 파일은 "공책 내용을 보고 구글 캘린더에 전화하는 담당"
 *
 * 화면(UI)은 캘린더까지 움직여야 할 때 이 파일의 함수를 부릅니다.
 */

import {
  rebuildTeacherGoogleCalendar,
  scheduleGoogleCalendarSync,
  syncStudentGoogleCalendarMirror,
} from "@/lib/integrations/googleCalendarSync";
import { readLocalStudents } from "@/lib/storage/sharedSnapshot";
import {
  applySessionPatches,
  applyStudentPatches,
  loadSessions,
  saveSessions,
} from "@/lib/storage/sessions";
import type { Session } from "@/lib/types/index";

function applyCalendarResyncPatch(args: {
  studentIds: Set<string>;
  teacherEmailChanged?: boolean;
  resetMeetUrl?: boolean;
  reason: string;
}): void {
  if (args.studentIds.size === 0) return;
  const current = loadSessions();
  let changed = false;

  const next = current.map((session) => {
    if (!args.studentIds.has(session.studentId)) return session;

    const patch: Partial<Session> = {
      googleCalendarStatus: "pending",
      googleCalendarError: args.reason,
    };

    if (args.teacherEmailChanged) {
      patch.googleCalendarOwnerEmail = undefined;
      patch.googleCalendarEventId = undefined;
      patch.googleMeetUrl = undefined;
    } else if (args.resetMeetUrl) {
      patch.googleMeetUrl = undefined;
    }

    const same = Object.entries(patch).every(([key, value]) => {
      const k = key as keyof Session;
      return session[k] === value;
    });
    if (same) return session;

    changed = true;
    return {
      ...session,
      ...patch,
    };
  });

  if (!changed) return;
  saveSessions(next, { serverRequired: true });
}

export function syncGoogleCalendarForExistingSessions(): void {
  const current = loadSessions();
  if (current.length === 0) return;

  // 기존 회차 중 eventId/meetUrl 미동기화 항목을 한 번에 동기화
  scheduleGoogleCalendarSync({
    previous: current,
    next: current,
    applyPatches: applySessionPatches,
    applyStudentPatch: applyStudentPatches,
  });
}

export function syncStudentGoogleCalendarMirrorForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  syncStudentGoogleCalendarMirror({
    studentIds,
    sessions: loadSessions(),
  });
}

export function rebuildTeacherGoogleCalendarForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const current = loadSessions();
  rebuildTeacherGoogleCalendar({
    studentIds,
    sessions: current,
    applyPatches: applySessionPatches,
    applyStudentPatch: applyStudentPatches,
  });
}

export function requestCalendarResyncForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const set = new Set(studentIds.filter((id) => typeof id === "string" && id.trim()));
  if (set.size === 0) return;

  applyCalendarResyncPatch({
    studentIds: set,
    reason: "학생 이메일 변경 반영을 위해 Meet 참석자를 다시 동기화합니다.",
  });
}

export function requestCalendarResyncForStudentIdsByAdmin(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const set = new Set(studentIds.filter((id) => typeof id === "string" && id.trim()));
  if (set.size === 0) return;

  applyCalendarResyncPatch({
    studentIds: set,
    reason: "관리자가 재동기화를 요청했습니다. 담당 선생님 계정 로그인 시 Meet 일정이 자동으로 다시 생성됩니다.",
  });
}

export function requestResetAndResyncMeetForStudentIds(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const set = new Set(studentIds.filter((id) => typeof id === "string" && id.trim()));
  if (set.size === 0) return;

  // 1. 학생들의 permanentMeetUrl 초기화 (로컬 스토리지 및 서버 스냅샷 반영)
  const studentPatches = Array.from(set).map((id) => ({
    id,
    patch: { permanentMeetUrl: undefined },
  }));
  applyStudentPatches(studentPatches);

  // 2. 세션들의 googleMeetUrl 초기화 및 pending 설정 (자동으로 캘린더 동기화 트리거되어 신규 발급 진행)
  applyCalendarResyncPatch({
    studentIds: set,
    resetMeetUrl: true,
    reason: "Google Meet 링크 일괄 초기화로 인해 신규 링크를 발급합니다.",
  });
}

export function requestResetAndResyncMeetForStudentIdsByAdmin(studentIds: string[]): void {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return;
  const set = new Set(studentIds.filter((id) => typeof id === "string" && id.trim()));
  if (set.size === 0) return;

  // 1. 학생들의 permanentMeetUrl 초기화
  const studentPatches = Array.from(set).map((id) => ({
    id,
    patch: { permanentMeetUrl: undefined },
  }));
  applyStudentPatches(studentPatches);

  // 2. 세션 pending 설정 (관리자 모드에서는 선생님 로그인 시 자동 생성되도록 유도)
  applyCalendarResyncPatch({
    studentIds: set,
    resetMeetUrl: true,
    reason: "관리자가 Google Meet 링크 일괄 초기화를 요청했습니다. 담당 선생님 로그인 시 신규 Meet가 자동 발급됩니다.",
  });
}

export function requestCalendarResyncForTeacherIds(teacherIds: string[]): void {
  if (!Array.isArray(teacherIds) || teacherIds.length === 0) return;
  const teacherSet = new Set(teacherIds.filter((id) => typeof id === "string" && id.trim()));
  if (teacherSet.size === 0) return;

  const students = readLocalStudents();
  const studentIds = students
    .filter((student) => student.teacherId && teacherSet.has(student.teacherId))
    .map((student) => student.id);

  applyCalendarResyncPatch({
    studentIds: new Set(studentIds),
    teacherEmailChanged: true,
    reason: "담당 선생님 이메일 변경으로 Meet 일정을 다시 생성합니다.",
  });
}
