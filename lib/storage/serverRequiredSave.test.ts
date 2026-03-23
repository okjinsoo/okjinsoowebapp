import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserStorage } from "@/lib/storage/browserStorage";
import type { Session, Student } from "@/lib/types/index";

const hoisted = vi.hoisted(() => ({
  pushSharedSnapshotMock: vi.fn(),
  loadLatestCoreSnapshotBaselineServerRequiredMock: vi.fn(),
  loadLatestCoreSnapshotBaselineMock: vi.fn(),
  mergeByIdMock: vi.fn((base: unknown[], patch: unknown[]) => [...base, ...patch]),
  syncRoleBindingEmailsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/storage/sharedSnapshot", () => ({
  pushSharedSnapshot: hoisted.pushSharedSnapshotMock,
  readLocalTeachers: vi.fn(() => []),
  readLocalStudents: vi.fn(() => []),
}));

vi.mock("@/lib/storage/safeSnapshotMerge", () => ({
  loadLatestCoreSnapshotBaseline: hoisted.loadLatestCoreSnapshotBaselineMock,
  loadLatestCoreSnapshotBaselineServerRequired:
    hoisted.loadLatestCoreSnapshotBaselineServerRequiredMock,
  mergeById: hoisted.mergeByIdMock,
}));

vi.mock("@/lib/auth/roleBindings", () => ({
  syncRoleBindingEmails: hoisted.syncRoleBindingEmailsMock,
}));

vi.mock("@/lib/integrations/googleCalendarSync", () => ({
  rebuildTeacherGoogleCalendar: vi.fn(),
  scheduleGoogleCalendarSync: vi.fn(),
  syncStudentGoogleCalendarMirror: vi.fn(),
}));

import { loadStudents, saveStudentsServerFirst } from "@/lib/storage/students";
import { loadSessions, saveSessionsServerFirst } from "@/lib/storage/sessions";

const originalWindow = (globalThis as { window?: unknown }).window;

function makeStudent(id: string): Student {
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
  };
}

function makeSession(args: { id: string; studentId: string; index: number }): Session {
  return {
    id: args.id,
    studentId: args.studentId,
    index: args.index,
    displayAt: "2026-03-02T11:00:00.000Z",
    state: "normal",
  };
}

describe("server-required save guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: vi.fn(),
    };
    browserStorage.clear();

    hoisted.loadLatestCoreSnapshotBaselineMock.mockResolvedValue({
      teachers: [],
      students: [],
      sessions: [],
    });
    hoisted.loadLatestCoreSnapshotBaselineServerRequiredMock.mockResolvedValue({
      teachers: [],
      students: [],
      sessions: [],
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
      return;
    }
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("saveStudentsServerFirst: 서버 기준 데이터가 없으면 로컬 학생 목록을 덮어쓰지 않는다", async () => {
    const original = [makeStudent("stu-old")];
    browserStorage.setItem("tutorweb_students_v1", JSON.stringify(original));

    hoisted.loadLatestCoreSnapshotBaselineServerRequiredMock.mockRejectedValueOnce(
      new Error("server_snapshot_unavailable")
    );

    await expect(saveStudentsServerFirst([makeStudent("stu-new")])).rejects.toThrow(
      "server_snapshot_unavailable"
    );

    expect(hoisted.pushSharedSnapshotMock).not.toHaveBeenCalled();
    expect(loadStudents({ forceFresh: true }).map((row) => row.id)).toEqual(["stu-old"]);
  });

  it("saveSessionsServerFirst: 서버 기준 데이터가 없으면 로컬 회차 목록을 덮어쓰지 않는다", async () => {
    const original = [makeSession({ id: "sess-old", studentId: "stu-old", index: 1 })];
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify(original));

    hoisted.loadLatestCoreSnapshotBaselineServerRequiredMock.mockRejectedValueOnce(
      new Error("server_snapshot_unavailable")
    );

    await expect(
      saveSessionsServerFirst([makeSession({ id: "sess-new", studentId: "stu-old", index: 1 })], {
        suppressCalendarSync: true,
      })
    ).rejects.toThrow("server_snapshot_unavailable");

    expect(hoisted.pushSharedSnapshotMock).not.toHaveBeenCalled();
    expect(loadSessions().map((row) => row.id)).toEqual(["sess-old"]);
  });
});
