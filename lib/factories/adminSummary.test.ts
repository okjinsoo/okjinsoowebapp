import { describe, expect, it } from "vitest";

import { buildAdminSummary, kstWeekRange } from "@/lib/factories/adminSummary";

describe("adminSummary", () => {
  it("주는 월요일~일요일 (KST)", () => {
    expect(kstWeekRange("2026-11-28")).toEqual({ start: "2026-11-23", end: "2026-11-29" }); // 토요일
    expect(kstWeekRange("2026-11-23")).toEqual({ start: "2026-11-23", end: "2026-11-29" }); // 월요일
    expect(kstWeekRange("2026-11-29")).toEqual({ start: "2026-11-23", end: "2026-11-29" }); // 일요일
  });

  it("재학생만 세고, 결석·주 밖 수업·기본 기록은 빼기", () => {
    const summary = buildAdminSummary(
      [
        {
          student: {
            status: "active",
            paymentHistory: [
              { id: "p1", paymentDate: "2026-10-01", addedCount: 8, startIndex: 1, endIndex: 8, createdAt: "2026-11-02T01:00:00Z" },
              { id: "p0", paymentDate: "2026-11-01", addedCount: 8, startIndex: 1, endIndex: 8, isBase: true },
              { id: "p2", paymentDate: "2026-11-30", addedCount: 4, startIndex: 9, endIndex: 12, createdAt: "2026-10-31T16:00:00Z" }, // KST 11-01
            ],
          },
          status: "need_extension",
          sessions: [
            { effectiveISO: "2026-11-23T10:00:00Z", meta: { status: "present" } },
            { effectiveISO: "2026-11-25T10:00:00Z", meta: { status: "absent" } },
            { effectiveISO: "2026-11-29T14:00:00Z", meta: {} }, // KST 11-29 23:00
            { effectiveISO: "2026-11-29T15:30:00Z", meta: {} }, // KST 11-30, 다음 주
          ],
        },
        {
          student: { status: "ended", paymentHistory: [{ id: "x", paymentDate: "2026-11-05", addedCount: 4, startIndex: 1, endIndex: 4 }] },
          status: "need_extension",
          sessions: [{ effectiveISO: "2026-11-24T10:00:00Z", meta: {} }],
        },
      ],
      "2026-11-28",
    );
    expect(summary).toEqual({ activeCount: 1, weekSessionCount: 2, extensionCount: 1, monthPaymentCount: 2 });
  });
});
