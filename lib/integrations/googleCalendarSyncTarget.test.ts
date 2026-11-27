import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Session, Student, Teacher } from "@/lib/types/index";

/**
 * syncSingleTarget(회차 1개 캘린더 맞추기) 동작 고정 테스트
 * - 실제 구글 서버에 요청하지 않도록 googleCalendarApi를 가짜(mock)로 바꿔서 확인합니다.
 */

vi.mock("@/lib/integrations/googleCalendarApi", () => ({
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  DUPLICATE_TIME_WINDOW_MS: 6 * 60 * 60 * 1000,
  findSessionEvents: vi.fn(),
  findSignatureEvents: vi.fn(),
  loadRecentCreatedEvent: vi.fn(),
  saveRecentCreatedEvent: vi.fn(),
  updateEvent: vi.fn(),
}));

import * as api from "@/lib/integrations/googleCalendarApi";
import { syncSingleTarget, type SyncTargetContext } from "@/lib/integrations/googleCalendarSyncTarget";

const mocked = vi.mocked(api);

const TEACHER_EMAIL = "teacher@example.com";
const ADMIN_EMAIL = "admin@example.com";
const APP_CAL = "app-cal@group.calendar.google.com";

const teacher: Teacher = { id: "t1", token: "tt1", name: "김선생", email: TEACHER_EMAIL };

function makeStudent(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu1",
    token: "tok1",
    name: "홍길동",
    cohort: "2026_test",
    status: "active",
    startDate: "2026-11-01",
    planCount: 12,
    scheduleRules: [{ weekday: 1, hour: 18, minute: 0, durationMin: 90 }],
    googleEmail: "student@example.com",
    studentPhone: "01000000000",
    parentPhone: "01000000001",
    school: "테스트중",
    grade: "8",
    teacherId: "t1",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    studentId: "stu1",
    index: 1,
    displayAt: "2026-11-02T09:00:00.000Z",
    state: "normal",
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SyncTargetContext> & { student?: Student | null } = {}): SyncTargetContext {
  const { student = makeStudent(), ...rest } = overrides;
  return {
    previousById: new Map(),
    studentById: new Map(student ? [[student.id, student]] : []),
    teacherById: new Map([[teacher.id, teacher]]),
    currentEmail: TEACHER_EMAIL,
    providerToken: "token-start",
    getActiveProviderToken: () => "token-active",
    getVerifiedTargetCalendarId: vi.fn(async () => APP_CAL),
    studentPermanentMeetMap: new Map(),
    studentConferenceDataMap: new Map(),
    metaMapByStudentId: new Map([["stu1", {}]]),
    stateKv: {},
    ...rest,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.findSessionEvents.mockResolvedValue([]);
  mocked.findSignatureEvents.mockResolvedValue([]);
  mocked.loadRecentCreatedEvent.mockReturnValue(null);
  mocked.deleteEvent.mockResolvedValue(undefined as never);
});

describe("syncSingleTarget — 담당자 확인 단계", () => {
  it("학생 정보를 못 찾으면 error 패치를 돌려준다", async () => {
    const patch = await syncSingleTarget(makeCtx({ student: null }), makeSession());
    expect(patch).toEqual({
      id: "s1",
      patch: {
        googleCalendarStatus: "error",
        googleCalendarError: "학생 정보를 찾지 못해 캘린더 동기화가 중단되었습니다.",
      },
    });
  });

  it("담당 선생님 이메일이 없으면 캘린더 연결 정보를 비우고 error로 둔다", async () => {
    const ctx = makeCtx({ student: makeStudent({ teacherId: undefined }) });
    const patch = await syncSingleTarget(ctx, makeSession({ googleCalendarEventId: "ev1" }));
    expect(patch?.patch.googleCalendarStatus).toBe("error");
    expect(patch?.patch.googleCalendarEventId).toBeUndefined();
    expect("googleCalendarEventId" in (patch?.patch ?? {})).toBe(true);
    expect(mocked.updateEvent).not.toHaveBeenCalled();
  });

  it("관리자(비소유자) 계정 + 변경 없음 + 동기화 완료 + 영구 링크 일치면 아무것도 안 한다", async () => {
    const meet = "https://meet.google.com/aaa-bbbb-ccc";
    const session = makeSession({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "ev1",
      googleMeetUrl: meet,
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarStatus: "synced",
    });
    const ctx = makeCtx({
      currentEmail: ADMIN_EMAIL,
      student: makeStudent({ permanentMeetUrl: meet }),
      previousById: new Map([[session.id, session]]),
    });
    expect(await syncSingleTarget(ctx, session)).toBeNull();
    expect(mocked.deleteEvent).not.toHaveBeenCalled();
  });

  it("관리자(비소유자) 계정에서 일정이 바뀌면 기존 연결은 유지한 채 pending으로 내린다", async () => {
    const prev = makeSession({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "ev1",
      googleMeetUrl: "https://meet.google.com/x",
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarStatus: "synced",
    });
    const next = { ...prev, displayAt: "2026-11-02T10:00:00.000Z" };
    const ctx = makeCtx({ currentEmail: ADMIN_EMAIL, previousById: new Map([[prev.id, prev]]) });
    const patch = await syncSingleTarget(ctx, next);
    expect(patch?.patch).toMatchObject({
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "ev1",
      googleCalendarStatus: "pending",
    });
    expect(mocked.updateEvent).not.toHaveBeenCalled();
  });

  it("잘못된 소유자(현재 로그인 계정)로 만들어진 이벤트는 지우고, 연결을 비운 pending으로 내린다", async () => {
    const next = makeSession({
      googleCalendarId: "admin-cal",
      googleCalendarEventId: "wrong-ev",
      googleCalendarOwnerEmail: ADMIN_EMAIL,
      googleCalendarStatus: "synced",
    });
    const ctx = makeCtx({ currentEmail: ADMIN_EMAIL });
    const patch = await syncSingleTarget(ctx, next);
    expect(mocked.deleteEvent).toHaveBeenCalledWith({
      token: "token-start",
      calendarId: "admin-cal",
      eventId: "wrong-ev",
    });
    expect(patch?.patch).toMatchObject({
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarId: undefined,
      googleCalendarEventId: undefined,
      googleMeetUrl: undefined,
      googleCalendarStatus: "pending",
    });
  });
});

describe("syncSingleTarget — 담당 선생님 계정으로 실제 반영", () => {
  it("이미 연결된 이벤트가 있으면 사전 검색 없이 바로 PATCH(updateEvent)하고 synced로 기록한다", async () => {
    const meet = "https://meet.google.com/perm";
    const prev = makeSession({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "ev1",
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarStatus: "synced",
    });
    const next = { ...prev, displayAt: "2026-11-02T10:00:00.000Z" };
    mocked.updateEvent.mockResolvedValue({ eventId: "ev1", meetUrl: meet, conferenceData: null });
    const ctx = makeCtx({
      student: makeStudent({ permanentMeetUrl: meet }),
      previousById: new Map([[prev.id, prev]]),
    });

    const patch = await syncSingleTarget(ctx, next);

    expect(mocked.findSessionEvents).not.toHaveBeenCalled();
    expect(mocked.updateEvent).toHaveBeenCalledTimes(1);
    expect(mocked.updateEvent.mock.calls[0][0]).toMatchObject({ token: "token-active", calendarId: APP_CAL });
    expect(patch?.patch).toMatchObject({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "ev1",
      googleMeetUrl: meet,
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarStatus: "synced",
      googleCalendarError: "",
    });
  });

  it("새 회차는 createEvent로 만들고, 처음 받은 Meet 링크를 학생 영구 링크로 저장해 공유한다", async () => {
    const newMeet = "https://meet.google.com/new";
    const conf = { conferenceId: "c1" };
    mocked.createEvent.mockResolvedValue({ eventId: "new-ev", meetUrl: newMeet, conferenceData: conf });
    const applyStudentPatch = vi.fn();
    const ctx = makeCtx({ applyStudentPatch });

    const patch = await syncSingleTarget(ctx, makeSession());

    expect(mocked.findSessionEvents).toHaveBeenCalledTimes(1);
    expect(mocked.saveRecentCreatedEvent).toHaveBeenCalledWith({
      ownerEmail: TEACHER_EMAIL,
      sessionId: "s1",
      eventId: "new-ev",
    });
    expect(ctx.studentPermanentMeetMap.get("stu1")).toBe(newMeet);
    expect(ctx.studentConferenceDataMap.get("stu1")).toBe(conf);
    expect(applyStudentPatch).toHaveBeenCalledWith([{ id: "stu1", patch: { permanentMeetUrl: newMeet } }]);
    expect(patch?.patch).toMatchObject({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "new-ev",
      googleMeetUrl: newMeet,
      googleCalendarStatus: "synced",
    });
  });

  it("기존 이벤트 PATCH가 404면 새 이벤트를 만들어 복구한다", async () => {
    const prev = makeSession({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "gone",
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarStatus: "synced",
      googleMeetUrl: "https://meet.google.com/perm",
    });
    mocked.updateEvent.mockRejectedValue(new Error("404 Not Found"));
    mocked.createEvent.mockResolvedValue({ eventId: "recreated", meetUrl: null, conferenceData: null });
    const ctx = makeCtx({
      student: makeStudent({ permanentMeetUrl: "https://meet.google.com/perm" }),
      previousById: new Map([[prev.id, prev]]),
    });

    const patch = await syncSingleTarget(ctx, { ...prev, displayAt: "2026-11-02T10:00:00.000Z" });

    expect(mocked.createEvent).toHaveBeenCalledTimes(1);
    expect(mocked.createEvent.mock.calls[0][0].session.googleCalendarEventId).toBeUndefined();
    expect(patch?.patch.googleCalendarEventId).toBe("recreated");
    expect(patch?.patch.googleCalendarStatus).toBe("synced");
  });

  it("그 밖의 오류는 error 패치로 오류 메시지를 남긴다", async () => {
    const prev = makeSession({
      googleCalendarId: APP_CAL,
      googleCalendarEventId: "ev1",
      googleCalendarOwnerEmail: TEACHER_EMAIL,
      googleCalendarStatus: "synced",
    });
    mocked.updateEvent.mockRejectedValue(new Error("500 Backend Error"));
    const ctx = makeCtx({ previousById: new Map([[prev.id, prev]]) });

    const patch = await syncSingleTarget(ctx, { ...prev, displayAt: "2026-11-02T10:00:00.000Z" });

    expect(mocked.createEvent).not.toHaveBeenCalled();
    expect(patch).toEqual({
      id: "s1",
      patch: { googleCalendarStatus: "error", googleCalendarError: "500 Backend Error" },
    });
  });
});
