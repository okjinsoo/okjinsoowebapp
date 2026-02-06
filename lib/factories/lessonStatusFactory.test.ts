import { describe, expect, test } from "vitest";
import { computeRefundRatio, normalizePaymentHistoryRanges } from "@/lib/factories/lessonStatusFactory";
import type { PaymentRecord } from "@/lib/types/index";

describe("lessonStatusFactory", () => {
  test("computeRefundRatio: 기본 카드(1~기본회차)는 1/4 이하 전액", () => {
    const rec: PaymentRecord = {
      id: "base",
      paymentDate: "2026-02-01",
      addedCount: 12,
      startIndex: 1,
      endIndex: 12,
      isBase: true,
    };
    // requestIndex=4 -> 진행 3회, 3/12=1/4
    expect(computeRefundRatio(rec, 4, true)).toBe("full");
  });

  test("computeRefundRatio: 일반 카드 구간 계산", () => {
    const rec: PaymentRecord = {
      id: "p1",
      paymentDate: "2026-02-01",
      addedCount: 12,
      startIndex: 13,
      endIndex: 24,
    };

    // 진행 2/12 => 1/6 < 1/3
    expect(computeRefundRatio(rec, 15, false)).toBe("two_thirds");
    // 진행 4/12 => 1/3 이상, 1/2 미만
    expect(computeRefundRatio(rec, 17, false)).toBe("half");
    // 진행 7/12 => 1/2 이상
    expect(computeRefundRatio(rec, 20, false)).toBe("none");
  });

  test("normalizePaymentHistoryRanges: 추가회차 변경 시 구간 재계산", () => {
    const records: PaymentRecord[] = [
      {
        id: "a",
        paymentDate: "2026-02-03",
        addedCount: 8,
        startIndex: 13,
        endIndex: 24,
      },
      {
        id: "b",
        paymentDate: "2026-03-01",
        addedCount: 12,
        startIndex: 25,
        endIndex: 36,
      },
    ];

    const out = normalizePaymentHistoryRanges(records, 12);
    expect(out[0].startIndex).toBe(13);
    expect(out[0].endIndex).toBe(20);
    expect(out[1].startIndex).toBe(21);
    expect(out[1].endIndex).toBe(32);
  });
});
