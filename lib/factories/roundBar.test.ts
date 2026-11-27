import { describe, expect, it } from "vitest";
import { buildRoundBar } from "@/lib/factories/roundBar";
import type { Student } from "@/lib/types/index";

const student = {
  id: "s1",
  token: "t1",
  name: "막대",
  planCount: 8,
  paymentHistory: [{ id: "p1", paymentDate: "2026-02-01", addedCount: 4, startIndex: 5, endIndex: 8 }],
} as unknown as Student;

describe("buildRoundBar", () => {
  it("uses the last session batch and marks past/absent/future", () => {
    const iso = (d: number) => `2026-02-${String(d).padStart(2, "0")}T08:00:00.000Z`;
    const bar = buildRoundBar({
      student,
      sessions: [
        { index: 4, effectiveISO: iso(1), meta: {} },
        { index: 5, effectiveISO: iso(2), meta: {} },
        { index: 6, effectiveISO: iso(3), meta: { status: "absent" } },
        { index: 7, effectiveISO: iso(9), meta: {} },
        { index: 8, effectiveISO: iso(10), meta: {} },
      ],
      nowMs: Date.parse("2026-02-05T00:00:00.000Z"),
    });
    expect(bar).toEqual({ start: 5, end: 8, cells: ["done", "absent", "todo", "todo"], remaining: 2 });
  });

  it("returns null when there is no batch", () => {
    expect(buildRoundBar({ student: { ...student, planCount: 0, paymentHistory: [] }, sessions: [], nowMs: 0 })).toBeNull();
  });
});
