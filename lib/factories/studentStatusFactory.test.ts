import { describe, expect, test } from "vitest";
import {
  computePauseLifecycle,
  computeStudentStatusFromMetrics,
  getStudentStatusMeta,
} from "@/lib/factories/studentStatusFactory";

describe("studentStatusFactory", () => {
  test("computePauseLifecycle: 마지막 수업일 당일은 confirmed, 다음날부터 paused", () => {
    expect(computePauseLifecycle("2026-02-05", "2026-02-05")).toBe("confirmed");
    expect(computePauseLifecycle("2026-02-06", "2026-02-05")).toBe("paused");
  });

  test("status 우선순위: paused > confirmed > pause_requested > overdue > need_extension > new > active", () => {
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "paused",
        hasPendingPauseRequest: true,
        overdueDays: 99,
        remainingCount: 1,
        passedCount: 1,
      })
    ).toBe("paused");

    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "confirmed",
        hasPendingPauseRequest: true,
        overdueDays: 99,
        remainingCount: 1,
        passedCount: 1,
      })
    ).toBe("pause_scheduled");

    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: true,
        overdueDays: 99,
        remainingCount: 1,
        passedCount: 1,
      })
    ).toBe("pause_requested");

    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 8,
        remainingCount: 1,
        passedCount: 100,
      })
    ).toBe("overdue_extension");

    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 3,
        passedCount: 100,
      })
    ).toBe("need_extension");

    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 10,
        passedCount: 3,
      })
    ).toBe("new");

    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "none",
        hasPendingPauseRequest: false,
        overdueDays: 0,
        remainingCount: 10,
        passedCount: 4,
      })
    ).toBe("active");
  });

  test("상태 배지 메타가 정의되어 있다", () => {
    expect(getStudentStatusMeta("new").label).toBe("신규생");
    expect(getStudentStatusMeta("pause_requested").label).toBe("휴회요청");
    expect(getStudentStatusMeta("paused").label).toBe("휴회생");
  });
});
