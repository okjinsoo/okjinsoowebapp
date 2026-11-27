import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { planAutoAttendance } from "@/lib/server/autoAttendance";
import type { Student } from "@/lib/types/index";

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "stu-1",
    token: "tok-1",
    name: "자동출석",
    cohort: "2026_auto",
    status: "active",
    startDate: "2026-02-02", // 월요일
    planCount: 8,
    scheduleRules: [
      { weekday: 1, hour: 17, minute: 0 },
      { weekday: 4, hour: 17, minute: 0 },
    ],
    ...overrides,
  } as Student;
}

const KEY = "tutorweb_metaMap_v1:tok-1";
const kst = (s: string) => Date.parse(`${s}+09:00`);

describe("planAutoAttendance", () => {
  it("marks ended planned sessions present, keeps absent and other fields", () => {
    const stateKv = { [KEY]: JSON.stringify({ 1: { record: "필기 링크" }, 2: { status: "absent" } }) };
    // 1회 2/2 17시, 2회 2/5 17시, 3회 2/9 17~18시
    const { patch, changes } = planAutoAttendance({
      students: [student()],
      stateKv,
      nowMs: kst("2026-02-09T18:30:00"),
    });
    expect(changes).toEqual([{ token: "tok-1", name: "자동출석", indices: [1, 3] }]);
    const next = JSON.parse(patch[KEY]);
    expect(next["1"]).toEqual({ record: "필기 링크", status: "present" });
    expect(next["2"]).toEqual({ status: "absent" });
    expect(next["3"]).toEqual({ status: "present" });
  });

  it("does not touch a session that has not ended yet", () => {
    const { changes } = planAutoAttendance({
      students: [student()],
      stateKv: {},
      nowMs: kst("2026-02-09T17:30:00"),
    });
    expect(changes[0].indices).toEqual([1, 2]);
  });

  it("skips non-active students and returns no patch when nothing changes", () => {
    const result = planAutoAttendance({
      students: [student({ status: "paused" }), student({ status: "ended", token: "tok-2" })],
      stateKv: {},
      nowMs: kst("2026-03-30T00:00:00"),
    });
    expect(result).toEqual({ patch: {}, changes: [] });
  });
});
