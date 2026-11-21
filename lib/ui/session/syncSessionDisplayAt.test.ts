import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { metaMapKey, readMetaMap } from "@/lib/ui/session/sessionEffective";
import type { Session, Student } from "@/lib/types/index";

const hoisted = vi.hoisted(() => ({
  pushSharedSnapshotMock: vi.fn(),
  readSnapshotServerFirstMock: vi.fn(),
  saveSessionsMock: vi.fn(),
  readLocalStudentsMock: vi.fn(),
  readLocalSessionsMock: vi.fn(),
}));

vi.mock("@/lib/storage/sharedSnapshot", () => ({
  pushSharedSnapshot: hoisted.pushSharedSnapshotMock,
  readLocalStudents: hoisted.readLocalStudentsMock,
  readLocalSessions: hoisted.readLocalSessionsMock,
}));

vi.mock("@/lib/storage/serverRead", () => ({
  findStudentByTokenInRows: (token: string, students: Student[]) =>
    students.find((s) => s.token === token) ?? null,
  readSnapshotServerFirst: hoisted.readSnapshotServerFirstMock,
}));

vi.mock("@/lib/storage/sessions", () => ({
  saveSessions: hoisted.saveSessionsMock,
}));

import { saveSessionAdjustmentByToken } from "@/lib/ui/session/syncSessionDisplayAt";

const originalWindow = (globalThis as { window?: unknown }).window;

function sampleStudent(): Student {
  return {
    id: "stu-a1",
    token: "tok-a1",
    name: "속도테스트학생",
    cohort: "2026_perf",
    status: "active",
    startDate: "2026-03-02", // 월요일
    planCount: 4,
    scheduleRules: [
      { weekday: 1, hour: 17, minute: 0, durationMin: 60 }, // 월 17:00
      { weekday: 3, hour: 17, minute: 0, durationMin: 60 }, // 수 17:00
    ],
    googleEmail: "perf@example.com",
    studentPhone: "01011112222",
    parentPhone: "01033334444",
    school: "테스트중",
    grade: "2",
  };
}

function sampleSessions(): Session[] {
  return [
    { id: "s1", studentId: "stu-a1", index: 1, displayAt: "2026-03-02T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
    { id: "s2", studentId: "stu-a1", index: 2, displayAt: "2026-03-04T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
    { id: "s3", studentId: "stu-a1", index: 3, displayAt: "2026-03-09T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
    { id: "s4", studentId: "stu-a1", index: 4, displayAt: "2026-03-11T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
    // 다른 학생 세션 (전송 대상에서 제외되어 부분 병합 시 충돌을 원천 차단해야 함)
    { id: "other-1", studentId: "stu-other", index: 1, displayAt: "2026-03-03T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
  ];
}

describe("saveSessionAdjustmentByToken (Phase A+B2 부분 병합, 롤백, 수업길이 동기화)", () => {
  const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: vi.fn((ev: { type: string; detail?: unknown }) => {
        dispatchedEvents.push({ type: ev.type, detail: ev.detail });
      }),
    };
    browserStorage.clear();
    dispatchedEvents.length = 0;
    hoisted.pushSharedSnapshotMock.mockResolvedValue({
      sessionsSynced: true,
      stateKvSynced: true,
    });
    hoisted.readLocalStudentsMock.mockReturnValue([]);
    hoisted.readLocalSessionsMock.mockReturnValue([]);
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("이월(+1) 저장 시 타 학생 세션은 제외하고 바뀐 세션만 sessionsMergeMode='merge'로 단 1회 POST한다", async () => {
    const student = sampleStudent();
    const sessions = sampleSessions();

    const saved = await saveSessionAdjustmentByToken({
      token: student.token,
      index: 1,
      patch: { carry: 1, reason: "개인 사정 이월" },
      students: [student],
      sessions,
    });

    expect(saved.ok).toBe(true);
    expect(hoisted.readSnapshotServerFirstMock).not.toHaveBeenCalled();

    // 서버 저장(POST /api/snapshot)은 단 1회만 호출되고 타 학생 세션("other-1")은 포함되지 않아야 한다.
    expect(hoisted.pushSharedSnapshotMock).toHaveBeenCalledTimes(1);
    const payload = hoisted.pushSharedSnapshotMock.mock.calls[0][0] as {
      stateKv?: Record<string, string>;
      sessions?: Session[];
      sessionsMergeMode?: string;
    };
    expect(payload.stateKv?.[metaMapKey(student.token)]).toBeDefined();
    expect(payload.sessionsMergeMode).toBe("merge");
    expect(payload.sessions?.map((s) => s.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(payload.sessions?.[0].displayAt).toBe("2026-03-04T08:00:00.000Z");
    expect(payload.sessions?.[1].displayAt).toBe("2026-03-09T08:00:00.000Z");

    expect(readMetaMap(student.token)[1]?.carry).toBe(1);
    expect(dispatchedEvents.filter((e) => e.type === BROWSER_STORAGE_EVENT)).toHaveLength(0);

    expect(hoisted.saveSessionsMock).toHaveBeenCalledTimes(1);
    expect(hoisted.saveSessionsMock.mock.calls[0][1]).toEqual({
      skipSharedSnapshot: true,
      previousOverride: sessions,
    });
  });

  it("출결 상태만 변경(날짜/수업길이 불변) 시 sessions 없이 stateKv만 단 1회 경량 POST한다", async () => {
    const student = sampleStudent();
    const sessions = sampleSessions();

    const saved = await saveSessionAdjustmentByToken({
      token: student.token,
      index: 1,
      patch: { status: "present" },
      students: [student],
      sessions,
    });

    expect(saved.ok).toBe(true);
    expect(hoisted.readSnapshotServerFirstMock).not.toHaveBeenCalled();
    expect(hoisted.pushSharedSnapshotMock).toHaveBeenCalledTimes(1);
    const payload = hoisted.pushSharedSnapshotMock.mock.calls[0][0] as {
      stateKv?: Record<string, string>;
      sessions?: Session[];
    };
    expect(payload.stateKv?.[metaMapKey(student.token)]).toBeDefined();
    expect(payload.sessions).toBeUndefined();
    expect(hoisted.saveSessionsMock).not.toHaveBeenCalled();
  });

  it("B-2: 시작 날짜/시간은 같고 수업 시간(overrideDurationMin)만 바뀌면 해당 1회차를 pending으로 동기화한다", async () => {
    const student = sampleStudent();
    const sessions = sampleSessions();

    const saved = await saveSessionAdjustmentByToken({
      token: student.token,
      index: 1,
      patch: {
        overrideDate: "2026-03-02",
        overrideHour: 17,
        overrideMinute: 0,
        overrideDurationMin: 90,
        overrideSource: "manual",
        reason: "30분 연장 수업",
      },
      students: [student],
      sessions,
    });

    expect(saved.ok).toBe(true);
    expect(hoisted.pushSharedSnapshotMock).toHaveBeenCalledTimes(1);
    const payload = hoisted.pushSharedSnapshotMock.mock.calls[0][0] as {
      sessions?: Session[];
      sessionsMergeMode?: string;
    };
    expect(payload.sessionsMergeMode).toBe("merge");
    expect(payload.sessions).toHaveLength(1);
    expect(payload.sessions?.[0].id).toBe("s1");
    expect(payload.sessions?.[0].googleCalendarStatus).toBe("pending");
    expect(hoisted.saveSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("서버 저장 실패 시 { ok: false }를 반환하고 로컬 metaMap을 이전 값으로 안전하게 롤백한다", async () => {
    const student = sampleStudent();
    const sessions = sampleSessions();
    // 기존 로컬 상태 세팅
    browserStorage.setItemSilent(
      metaMapKey(student.token),
      JSON.stringify({ 1: { status: "planned", carry: 0, reason: "원래사유" } })
    );

    hoisted.pushSharedSnapshotMock.mockResolvedValueOnce({
      sessionsSynced: false,
      stateKvSynced: false,
    });

    const saved = await saveSessionAdjustmentByToken({
      token: student.token,
      index: 1,
      patch: {
        overrideDate: "2026-03-05",
        overrideHour: 19,
        overrideMinute: 30,
        overrideSource: "manual",
        reason: "실패할 보강",
      },
      students: [student],
      sessions,
    });

    expect(saved.ok).toBe(false);
    // 로컬 metaMap이 이전 값("원래사유", overrideDate 없음)으로 정확히 원복되어야 한다.
    expect(readMetaMap(student.token)[1]?.reason).toBe("원래사유");
    expect(readMetaMap(student.token)[1]?.overrideDate).toBe("");
    expect(hoisted.saveSessionsMock).not.toHaveBeenCalled();
  });
});
