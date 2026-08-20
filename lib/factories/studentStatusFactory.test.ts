import { describe, expect, test } from "vitest";
import {
  computeDaysUntilSession,
  computePauseLifecycle,
  computeStudentStatusFromMetrics,
  getStudentStatusMeta,
} from "@/lib/factories/studentStatusFactory";

describe("studentStatusFactory", () => {
  test("computePauseLifecycle: 마지막 수업일 당일은 confirmed, 다음날부터 paused", () => {
    expect(computePauseLifecycle("2026-02-05", "2026-02-05")).toBe("confirmed");
    expect(computePauseLifecycle("2026-02-06", "2026-02-05")).toBe("paused");
  });

  test("computeDaysUntilSession: 오늘과 마지막 수업일 사이 일수(D-Day) 계산", () => {
    expect(computeDaysUntilSession("2026-08-21", "2026-08-30")).toBe(9); // D-9
    expect(computeDaysUntilSession("2026-08-21", "2026-08-21")).toBe(0); // D-Day 당일
    expect(computeDaysUntilSession("2026-08-21", "2026-08-20")).toBe(-1); // 지난 수업
    expect(computeDaysUntilSession("2026-08-21", null)).toBeNull();
  });

  test("상태 분류: 연장필요(마지막 수업 9일 전 이하) > 신규생 > 재학생", () => {
    // 1) 마지막 수업이 9일 전(D-9)인 경우 -> 연장필요
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 5,
        passedCount: 7,
        daysUntilLastSession: 9,
      })
    ).toBe("need_extension");

    // 2) 마지막 수업이 5일 전(D-5)이거나 이미 지난 경우(-1일) -> 연장필요
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 1,
        remainingCount: 0,
        passedCount: 12,
        daysUntilLastSession: -1,
      })
    ).toBe("need_extension");

    // 3) 마지막 수업이 10일 이상 남았고(D-10) 지난 수업이 3회 이하인 경우 -> 신규생
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 10,
        passedCount: 2,
        daysUntilLastSession: 30,
      })
    ).toBe("new");

    // 4) 마지막 수업이 10일 이상 남았고(D-10) 지난 수업이 4회 이상인 경우 -> 재학생
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 8,
        passedCount: 4,
        daysUntilLastSession: 20,
      })
    ).toBe("active");

    // 5) 마지막 수업 날짜 정보가 없는 경우 fallback: remainingCount <= 0 이면 연장필요
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 0,
        passedCount: 12,
        daysUntilLastSession: null,
      })
    ).toBe("need_extension");
  });

  test("상태 배지 메타가 정의되어 있다", () => {
    expect(getStudentStatusMeta("new").label).toBe("신규생");
    expect(getStudentStatusMeta("need_extension").label).toBe("연장필요");
    expect(getStudentStatusMeta("active").label).toBe("재학생");
  });
});
