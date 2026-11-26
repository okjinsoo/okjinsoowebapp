import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserStorage } from "@/lib/storage/browserStorage";
import type { Session, Student, Teacher } from "@/lib/types/index";

/**
 * 동작 고정 테스트: "저장소(lib/storage) ↔ 구글 캘린더" 연결 규칙
 *
 * 리팩토링(캘린더 결합 분리) 전후로 아래 동작이 똑같이 유지되는지 확인합니다.
 * 1) 회차 저장 시 캘린더 동기화가 1번 예약된다 (이전/다음 회차 목록 그대로 전달)
 * 2) 캘린더 동기화를 끄고 저장하면 예약되지 않는다
 * 3) 학생 이메일이 바뀌면 그 학생 회차가 pending으로 바뀌고 캘린더 동기화가 예약된다
 * 4) 선생님 이메일이 바뀌면 담당 학생 회차의 캘린더 소유 정보가 초기화된다
 * 5) Meet 일괄 초기화 시 학생 영구 Meet 링크와 회차 Meet 링크가 비워진다
 */

const hoisted = vi.hoisted(() => ({
  scheduleGoogleCalendarSyncMock: vi.fn(),
  pushSharedSnapshotMock: vi.fn().mockResolvedValue({ sessionsSynced: true }),
  emptyBaseline: { teachers: [], students: [], sessions: [] },
}));

vi.mock("@/lib/integrations/googleCalendarSync", () => ({
  rebuildTeacherGoogleCalendar: vi.fn(),
  scheduleGoogleCalendarSync: hoisted.scheduleGoogleCalendarSyncMock,
  syncStudentGoogleCalendarMirror: vi.fn(),
}));

vi.mock("@/lib/storage/sharedSnapshot", async () => {
  const { browserStorage: storage } = await import("@/lib/storage/browserStorage");
  const read = <T,>(key: string): T[] => {
    try {
      return JSON.parse(storage.getItem(key) ?? "[]") as T[];
    } catch {
      return [];
    }
  };
  return {
    STUDENTS_KEY: "tutorweb_students_v1",
    pushSharedSnapshot: hoisted.pushSharedSnapshotMock,
    readLocalStudents: () => read<Student>("tutorweb_students_v1"),
    readLocalTeachers: () => read<Teacher>("tutorweb_teachers_v1"),
  };
});

vi.mock("@/lib/storage/safeSnapshotMerge", () => ({
  loadLatestCoreSnapshotBaseline: vi.fn().mockResolvedValue(hoisted.emptyBaseline),
  loadLatestCoreSnapshotBaselineServerRequired: vi.fn().mockResolvedValue(hoisted.emptyBaseline),
  mergeById: vi.fn((base: unknown[], patch: unknown[]) => [...base, ...patch]),
}));

vi.mock("@/lib/auth/roleBindings", () => ({
  syncRoleBindingEmails: vi.fn().mockResolvedValue(undefined),
}));

// ── 테스트 대상 ──
// saveSessions = 저장만 / *AndSyncCalendar, *AndResyncCalendar = 저장 + 캘린더 연동
import { loadSessions, saveSessions as saveSessionsWithoutCalendar } from "@/lib/storage/sessions";
import {
  requestResetAndResyncMeetForStudentIds,
  saveSessionsAndSyncCalendar,
} from "@/lib/integrations/sessionCalendarActions";
import {
  saveStudentsAndResyncCalendar,
  saveTeachersAndResyncCalendar,
} from "@/lib/integrations/rosterCalendarActions";

const originalWindow = (globalThis as { window?: unknown }).window;
// 저장소 함수에 50ms 단기 캐시가 있어서, 테스트끼리 캐시가 섞이지 않도록 매 테스트마다 시계를 1분씩 넘깁니다.
let fakeNow = Date.UTC(2026, 10, 27, 0, 0, 0);

function makeTeacher(id: string, email: string): Teacher {
  return { id, token: `tok-${id}`, name: `선생-${id}`, email };
}

function makeStudent(id: string, extra?: Partial<Student>): Student {
  return {
    id,
    token: `tok-${id}`,
    name: `학생-${id}`,
    cohort: "2026_test",
    status: "active",
    startDate: "2026-03-01",
    planCount: 12,
    scheduleRules: [{ weekday: 1, hour: 20, minute: 0 }],
    googleEmail: `${id}@example.com`,
    studentPhone: "01000000000",
    parentPhone: "01000000001",
    school: "테스트중",
    grade: "2",
    ...extra,
  };
}

function makeSession(id: string, studentId: string, extra?: Partial<Session>): Session {
  return {
    id,
    studentId,
    index: 1,
    displayAt: "2026-03-02T11:00:00.000Z",
    state: "normal",
    ...extra,
  };
}

function readSessionsRaw(): Session[] {
  return JSON.parse(browserStorage.getItem("tutorweb_sessions_v1") ?? "[]") as Session[];
}

describe("저장소 ↔ 캘린더 연결 동작 고정", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    fakeNow += 60_000;
    vi.setSystemTime(fakeNow);
    (globalThis as { window?: unknown }).window = { dispatchEvent: vi.fn() };
    browserStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
      return;
    }
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("1) 회차 저장 시 캘린더 동기화를 이전/다음 목록과 함께 1번 예약한다", () => {
    const before = [makeSession("s1", "stu1")];
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify(before));
    const next = [makeSession("s1", "stu1"), makeSession("s2", "stu1", { index: 2 })];

    saveSessionsAndSyncCalendar(next, { skipSharedSnapshot: true });

    expect(hoisted.scheduleGoogleCalendarSyncMock).toHaveBeenCalledTimes(1);
    const arg = hoisted.scheduleGoogleCalendarSyncMock.mock.calls[0][0];
    expect(arg.previous.map((s: Session) => s.id)).toEqual(["s1"]);
    expect(arg.next.map((s: Session) => s.id)).toEqual(["s1", "s2"]);
    expect(typeof arg.applyPatches).toBe("function");
    expect(typeof arg.applyStudentPatch).toBe("function");
    expect(loadSessions().map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("1-b) previousOverride를 주면 그 목록을 이전 상태로 전달한다", () => {
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify([makeSession("s1", "stu1")]));
    const override = [makeSession("old", "stu1")];

    saveSessionsAndSyncCalendar([makeSession("s1", "stu1")], {
      skipSharedSnapshot: true,
      previousOverride: override,
    });

    const arg = hoisted.scheduleGoogleCalendarSyncMock.mock.calls[0][0];
    expect(arg.previous.map((s: Session) => s.id)).toEqual(["old"]);
  });

  it("1-c) 캘린더가 넘겨준 회차 패치(applyPatches)는 로컬 회차에 반영된다", () => {
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify([makeSession("s1", "stu1")]));
    saveSessionsAndSyncCalendar([makeSession("s1", "stu1")], { skipSharedSnapshot: true });

    const arg = hoisted.scheduleGoogleCalendarSyncMock.mock.calls[0][0];
    arg.applyPatches([{ id: "s1", patch: { googleCalendarEventId: "evt-1" } }]);

    expect(readSessionsRaw()[0].googleCalendarEventId).toBe("evt-1");
  });

  it("2) 캘린더 동기화 없이 저장하면 예약되지 않는다", () => {
    saveSessionsWithoutCalendar([makeSession("s1", "stu1")], { skipSharedSnapshot: true });

    expect(hoisted.scheduleGoogleCalendarSyncMock).not.toHaveBeenCalled();
    expect(loadSessions().map((s) => s.id)).toEqual(["s1"]);
  });

  it("3) 학생 이메일이 바뀌면 그 학생 회차만 pending이 되고 캘린더 동기화가 예약된다", () => {
    browserStorage.setItem(
      "tutorweb_students_v1",
      JSON.stringify([makeStudent("stu1"), makeStudent("stu2")])
    );
    browserStorage.setItem(
      "tutorweb_sessions_v1",
      JSON.stringify([
        makeSession("s1", "stu1", { googleCalendarStatus: "synced" }),
        makeSession("s2", "stu2", { googleCalendarStatus: "synced" }),
      ])
    );

    saveStudentsAndResyncCalendar(
      [makeStudent("stu1", { googleEmail: "changed@example.com" }), makeStudent("stu2")],
      { skipSharedSnapshot: true }
    );

    const rows = readSessionsRaw();
    expect(rows.find((s) => s.id === "s1")?.googleCalendarStatus).toBe("pending");
    expect(rows.find((s) => s.id === "s2")?.googleCalendarStatus).toBe("synced");
    expect(hoisted.scheduleGoogleCalendarSyncMock).toHaveBeenCalledTimes(1);
  });

  it("3-b) 학생 이메일이 그대로면 회차와 캘린더는 건드리지 않는다", () => {
    browserStorage.setItem("tutorweb_students_v1", JSON.stringify([makeStudent("stu1")]));
    browserStorage.setItem(
      "tutorweb_sessions_v1",
      JSON.stringify([makeSession("s1", "stu1", { googleCalendarStatus: "synced" })])
    );

    saveStudentsAndResyncCalendar([makeStudent("stu1", { name: "이름만 변경" })], {
      skipSharedSnapshot: true,
    });

    expect(readSessionsRaw()[0].googleCalendarStatus).toBe("synced");
    expect(hoisted.scheduleGoogleCalendarSyncMock).not.toHaveBeenCalled();
  });

  it("4) 선생님 이메일이 바뀌면 담당 학생 회차의 캘린더 소유 정보가 초기화된다", () => {
    browserStorage.setItem(
      "tutorweb_teachers_v1",
      JSON.stringify([makeTeacher("t1", "t1@example.com")])
    );
    browserStorage.setItem(
      "tutorweb_students_v1",
      JSON.stringify([makeStudent("stu1", { teacherId: "t1" }), makeStudent("stu2", { teacherId: "t2" })])
    );
    browserStorage.setItem(
      "tutorweb_sessions_v1",
      JSON.stringify([
        makeSession("s1", "stu1", {
          googleCalendarStatus: "synced",
          googleCalendarEventId: "evt-1",
          googleCalendarOwnerEmail: "t1@example.com",
          googleMeetUrl: "https://meet.google.com/aaa",
        }),
        makeSession("s2", "stu2", { googleCalendarStatus: "synced", googleCalendarEventId: "evt-2" }),
      ])
    );

    saveTeachersAndResyncCalendar([makeTeacher("t1", "new-t1@example.com")], {
      skipSharedSnapshot: true,
    });

    const rows = readSessionsRaw();
    const s1 = rows.find((s) => s.id === "s1");
    expect(s1?.googleCalendarStatus).toBe("pending");
    expect(s1?.googleCalendarEventId).toBeUndefined();
    expect(s1?.googleCalendarOwnerEmail).toBeUndefined();
    expect(s1?.googleMeetUrl).toBeUndefined();
    expect(rows.find((s) => s.id === "s2")?.googleCalendarEventId).toBe("evt-2");
    expect(hoisted.scheduleGoogleCalendarSyncMock).toHaveBeenCalledTimes(1);
  });

  it("5) Meet 일괄 초기화 시 학생 영구 Meet와 회차 Meet 링크를 비우고 pending으로 만든다", () => {
    browserStorage.setItem(
      "tutorweb_students_v1",
      JSON.stringify([makeStudent("stu1", { permanentMeetUrl: "https://meet.google.com/perm" })])
    );
    browserStorage.setItem(
      "tutorweb_sessions_v1",
      JSON.stringify([
        makeSession("s1", "stu1", {
          googleCalendarStatus: "synced",
          googleCalendarEventId: "evt-1",
          googleMeetUrl: "https://meet.google.com/aaa",
        }),
      ])
    );

    requestResetAndResyncMeetForStudentIds(["stu1"]);

    const students = JSON.parse(browserStorage.getItem("tutorweb_students_v1") ?? "[]") as Student[];
    expect(students[0].permanentMeetUrl).toBeUndefined();
    const s1 = readSessionsRaw()[0];
    expect(s1.googleCalendarStatus).toBe("pending");
    expect(s1.googleMeetUrl).toBeUndefined();
    expect(s1.googleCalendarEventId).toBe("evt-1");
    expect(hoisted.scheduleGoogleCalendarSyncMock).toHaveBeenCalledTimes(1);
  });
});
