// Node 순수 환경 검증용 테스트 (browserStorage / window 의존 없음)
import { describe, expect, it } from "vitest";
import { computeNextSessionsForStudent } from "@/lib/factories/sessionDisplaySync";
import type { Session, Student } from "@/lib/types/index";

function sampleStudent(): Student {
  return {
    id: "stu-sync",
    token: "tok-sync",
    name: "순수동기화",
    cohort: "2026_sync",
    status: "active",
    startDate: "2026-03-02",
    planCount: 4,
    scheduleRules: [
      { weekday: 1, hour: 17, minute: 0, durationMin: 60 },
      { weekday: 3, hour: 17, minute: 0, durationMin: 60 },
    ],
    googleEmail: "sync@example.com",
    studentPhone: "01011112222",
    parentPhone: "01033334444",
    school: "테스트중",
    grade: "2",
  };
}

function sampleSessions(): Session[] {
  return [
    { id: "s1", studentId: "stu-sync", index: 1, displayAt: "2026-03-02T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
    { id: "s2", studentId: "stu-sync", index: 2, displayAt: "2026-03-04T08:00:00.000Z", state: "normal", googleCalendarStatus: "synced" },
    { id: "virtual_3", studentId: "stu-sync", index: 3, displayAt: "2026-03-09T08:00:00.000Z", state: "normal" },
    { id: "other_1", studentId: "stu-other", index: 1, displayAt: "2026-03-02T08:00:00.000Z", state: "normal" },
  ];
}

describe("sessionDisplaySync (순수 계산 검증)", () => {
  it("타 학생 세션과 virtual_ 세션은 건드리지 않고 바뀐 본인 실세션만 추려낸다", () => {
    const student = sampleStudent();
    const sessions = sampleSessions();
    const result = computeNextSessionsForStudent({
      token: student.token,
      student,
      sessions,
      metaMap: { 1: { carry: 1 } },
    });

    expect(result.changed).toBe(true);
    expect(result.changedSessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(result.changedSessions[0].displayAt).toBe("2026-03-04T08:00:00.000Z");
    expect(result.nextSessions.find((s) => s.id === "virtual_3")?.displayAt).toBe("2026-03-09T08:00:00.000Z");
    expect(result.nextSessions.find((s) => s.id === "other_1")?.displayAt).toBe("2026-03-02T08:00:00.000Z");
  });

  it("날짜가 같아도 forceResyncIndex가 지정되면 해당 회차만 googleCalendarStatus='pending'으로 표시한다", () => {
    const student = sampleStudent();
    const sessions = sampleSessions();
    const result = computeNextSessionsForStudent({
      token: student.token,
      student,
      sessions,
      metaMap: {},
      forceResyncIndex: 1,
    });

    expect(result.changed).toBe(true);
    expect(result.changedSessions).toHaveLength(1);
    expect(result.changedSessions[0].id).toBe("s1");
    expect(result.changedSessions[0].googleCalendarStatus).toBe("pending");
  });
});
