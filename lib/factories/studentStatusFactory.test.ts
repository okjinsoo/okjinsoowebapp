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

  test("상태 분류: 연장필요 > 신규생 > 재학생", () => {
    expect(
      computeStudentStatusFromMetrics({
        pauseLifecycle: "paused",
        hasPendingPauseRequest: true,
        overdueDays: 99,
        remainingCount: 1,
        passedCount: 1,
      })
    ).toBe("need_extension");

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
    expect(getStudentStatusMeta("need_extension").label).toBe("연장필요");
    expect(getStudentStatusMeta("active").label).toBe("재학생");
  });
});
