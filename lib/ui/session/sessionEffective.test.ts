import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Student } from "@/lib/types/index";
import { browserStorage } from "@/lib/storage/browserStorage";
import { ymdFromISO_KST } from "@/lib/utils/date";
import { buildBadges, buildBaseDatesISO, computeEffectiveISO, metaMapKey } from "@/lib/ui/session/sessionEffective";

function sampleStudent(): Student {
  return {
    id: "stu-1",
    token: "tok-1",
    name: "테스트학생",
    cohort: "2026_demo",
    status: "active",
    startDate: "2026-02-09",
    planCount: 20,
    scheduleRules: [
      { weekday: 1, hour: 20, minute: 0 }, // 월
      { weekday: 3, hour: 20, minute: 0 }, // 수
    ],
    googleEmail: "test@example.com",
    studentPhone: "01000000000",
    parentPhone: "01000000001",
    school: "테스트중",
    grade: "2",
    scheduleChangeEvents: [
      {
        id: "chg-1",
        startIndex: 5,
        startDate: "2026-03-08",
        newRules: [
          { weekday: 2, hour: 20, minute: 0 }, // 화
          { weekday: 4, hour: 20, minute: 0 }, // 목
          { weekday: 5, hour: 20, minute: 0 }, // 금
        ],
      },
    ],
  };
}

describe("sessionEffective schedule change by date", () => {
  beforeEach(() => {
    browserStorage.clear();
  });

  afterEach(() => {
    browserStorage.clear();
  });

  it("keeps earlier sessions and applies new timetable from selected start date", () => {
    const student = sampleStudent();

    // 이월 +2 (3회차), 이월 +2 (5회차)
    browserStorage.setItem(
      metaMapKey(student.token),
      JSON.stringify({
        3: { carry: 2 },
        5: { carry: 2 },
      })
    );

    const baseDatesISO = buildBaseDatesISO(student, 60);
    const metaMap = {
      3: { carry: 2 },
      5: { carry: 2 },
    };

    const ymdOf = (index: number) =>
      ymdFromISO_KST(
        computeEffectiveISO({
          token: student.token,
          index,
          baseDatesISO,
          metaMap,
        }).effectiveISO
      );

    expect(ymdOf(3)).toBe("2026-02-23");
    expect(ymdOf(4)).toBe("2026-02-25");
    expect(ymdOf(5)).toBe("2026-03-10");
    expect(ymdOf(6)).toBe("2026-03-12");
    expect(ymdOf(7)).toBe("2026-03-13");
  });

  it("hides '변경' badge for extension-generated override and shows it for manual override", () => {
    expect(
      buildBadges({
        overrideDate: "2026-03-10",
        overrideHour: 20,
        overrideMinute: 0,
        overrideSource: "extension",
        reason: "",
        record: "",
      })
    ).toEqual([]);

    expect(
      buildBadges({
        overrideDate: "2026-03-10",
        overrideHour: 20,
        overrideMinute: 0,
        overrideSource: "manual",
        reason: "학원 일정 변경",
      })
    ).toEqual(["변경"]);
  });
});
