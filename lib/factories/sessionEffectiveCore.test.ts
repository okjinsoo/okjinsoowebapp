// Node 순수 환경 검증용 테스트 (browserStorage / window 의존 없음)
import { describe, expect, it } from "vitest";
import {
  buildBaseDatesISOFromMetaMap,
  buildUpdatedMetaMapFromCurrent,
  computeEffectiveISO,
  mergeEffectiveMetaMap,
  metaMapKey,
  parseMetaMapFromRaw,
  resolveActiveScheduleRulesCore,
  ymdFromISO_KST,
} from "@/lib/factories/sessionEffectiveCore";
import type { Student } from "@/lib/types/index";

function mockStudent(): Student {
  return {
    id: "stu-pure",
    token: "tok-pure",
    name: "순수테스트",
    cohort: "2026_pure",
    status: "active",
    startDate: "2026-02-02",
    planCount: 8,
    scheduleRules: [
      { weekday: 1, hour: 17, minute: 0 },
      { weekday: 4, hour: 17, minute: 0 },
    ],
    scheduleChangeEvents: [
      {
        id: "chg-5",
        startIndex: 5,
        startDate: "2026-02-17",
        newRules: [
          { weekday: 2, hour: 19, minute: 0 },
          { weekday: 4, hour: 19, minute: 0 },
        ],
      },
    ],
    googleEmail: "pure@example.com",
    studentPhone: "01011112222",
    parentPhone: "01033334444",
    school: "순수중",
    grade: "2",
  };
}

describe("sessionEffectiveCore (브라우저 의존 없는 순수 계산 검증)", () => {
  it("buildBaseDatesISOFromMetaMap + computeEffectiveISO + resolveActiveScheduleRulesCore가 순수 Node 환경에서 동작한다", () => {
    const student = mockStudent();
    const metaMap = { 2: { carry: 1 } };
    const baseDatesISO = buildBaseDatesISOFromMetaMap(student, 20, metaMap);

    const eff1 = computeEffectiveISO({ token: student.token, index: 1, baseDatesISO, metaMap }).effectiveISO;
    const eff2 = computeEffectiveISO({ token: student.token, index: 2, baseDatesISO, metaMap }).effectiveISO;
    expect(ymdFromISO_KST(eff1 ?? "")).toBe("2026-02-02");
    expect(ymdFromISO_KST(eff2 ?? "")).toBe("2026-02-09");

    // 4회차(2026-02-16 월) 당일은 기존 규칙, 익일(2026-02-17 화)은 새 규칙
    expect(
      resolveActiveScheduleRulesCore({
        student,
        targetYmd: "2026-02-16",
        baseDatesISO,
        metaMap,
      })
    ).toEqual(student.scheduleRules);
    expect(
      resolveActiveScheduleRulesCore({
        student,
        targetYmd: "2026-02-17",
        baseDatesISO,
        metaMap,
      })
    ).toEqual([
      { weekday: 2, hour: 19, minute: 0 },
      { weekday: 4, hour: 19, minute: 0 },
    ]);
  });

  it("buildUpdatedMetaMapFromCurrent와 mergeEffectiveMetaMap이 순수 입력만으로 정확히 동작한다", () => {
    const serverMeta = parseMetaMapFromRaw(
      JSON.stringify({
        1: { status: "present", reason: "서버" },
        2: { status: "planned", reason: "서버2" },
      })
    );
    const updated = buildUpdatedMetaMapFromCurrent({}, "tok-pure", 2, {
      status: "absent",
      reason: "로컬2",
    });
    expect(updated.key).toBe(metaMapKey("tok-pure"));
    const merged = mergeEffectiveMetaMap(serverMeta, updated.nextMetaMap);
    expect(merged[1]?.reason).toBe("서버");
    expect(merged[2]?.status).toBe("absent");
    expect(merged[2]?.reason).toBe("로컬2");
  });
});
