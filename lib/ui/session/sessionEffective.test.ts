import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Student } from "@/lib/types/index";
import { browserStorage } from "@/lib/storage/browserStorage";
import { ymdFromISO_KST } from "@/lib/utils/date";
import { buildBaseDatesISO, computeEffectiveISO, metaMapKey } from "@/lib/ui/session/sessionEffective";

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
    expect(ymdOf(5)).toBe("2026-03-13");
    expect(ymdOf(6)).toBe("2026-03-17");
    expect(ymdOf(7)).toBe("2026-03-19");
  });

  it("carry+1 bypasses extension override and uses baseDatesISO slot (no schedule change)", () => {
    // 순수 수/토 스케줄 (시간 변경 없음) - carry가 extension override를 건너뛰는지 검증
    const student: Student = {
      id: "stu-carry",
      token: "tok-carry",
      name: "이월테스트",
      cohort: "2026_carry",
      status: "active",
      startDate: "2026-03-11", // 2026-03-11 = 수요일
      planCount: 10,
      scheduleRules: [
        { weekday: 3, hour: 23, minute: 0 }, // 수 23:00
        { weekday: 6, hour: 23, minute: 0 }, // 토 23:00
      ],
      googleEmail: "carry@example.com",
      studentPhone: "01000000000",
      parentPhone: "01000000001",
      school: "테스트중",
      grade: "2",
    };

    // 결제 시 자동 생성된 extension override (정상 날짜이지만 extension)
    // baseDatesISO[0]=3월11일수, [1]=3월14일토, [2]=3월18일수, [3]=3월21일토, [4]=3월25일수
    const metaMapNoCarry = {
      1: { overrideDate: "2026-03-11", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
      2: { overrideDate: "2026-03-14", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
      3: { overrideDate: "2026-03-18", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
      4: { overrideDate: "2026-03-21", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
    };

    // 이월 없을 때: extension override 그대로 사용 (carry=0)
    {
      browserStorage.setItem(metaMapKey(student.token), JSON.stringify(metaMapNoCarry));
      const baseDatesISO = buildBaseDatesISO(student, 60);
      const ymdOf = (index: number) =>
        ymdFromISO_KST(computeEffectiveISO({ token: student.token, index, baseDatesISO, metaMap: metaMapNoCarry }).effectiveISO);
      expect(ymdOf(1)).toBe("2026-03-11"); // extension override 반영 ✅
      expect(ymdOf(2)).toBe("2026-03-14"); // extension override 반영 ✅
    }

    // 1회차에 이월 +1 적용: skip=1 → extension override 무시하고 baseDatesISO[N] 사용
    const metaMapWithCarry = {
      ...metaMapNoCarry,
      1: { ...metaMapNoCarry[1], carry: 1 },
    };
    browserStorage.setItem(metaMapKey(student.token), JSON.stringify(metaMapWithCarry));
    const baseDatesISO = buildBaseDatesISO(student, 60);
    const ymdOf = (index: number) =>
      ymdFromISO_KST(computeEffectiveISO({ token: student.token, index, baseDatesISO, metaMap: metaMapWithCarry }).effectiveISO);

    // 1회차 carry=1: skip=1, baseIdx=1 → baseDatesISO[1] = 3월14일토
    expect(ymdOf(1)).toBe("2026-03-14"); // 土 (extension 무시, carry 반영)
    // 2회차: skip=1, baseIdx=2 → baseDatesISO[2] = 3월18일수
    expect(ymdOf(2)).toBe("2026-03-18"); // 水
    // 3회차: skip=1, baseIdx=3 → baseDatesISO[3] = 3월21일토
    expect(ymdOf(3)).toBe("2026-03-21"); // 土
  });
});
