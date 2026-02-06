import { afterEach, describe, expect, test, vi } from "vitest";
import { kstDateMs, todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";

describe("date utils (KST)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("ymdFromISO_KST keeps KST date for KST ISO", () => {
    expect(ymdFromISO_KST("2026-02-10T00:30:00+09:00")).toBe("2026-02-10");
  });

  test("ymdFromISO_KST converts UTC ISO to KST date", () => {
    // 2026-02-09T16:30:00Z == 2026-02-10 01:30 KST
    expect(ymdFromISO_KST("2026-02-09T16:30:00Z")).toBe("2026-02-10");
  });

  test("todayYmdKST uses KST calendar day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-09T15:30:00Z"));
    expect(todayYmdKST()).toBe("2026-02-10");
  });

  test("kstDateMs matches KST midnight", () => {
    const expected = new Date("2026-02-10T00:00:00+09:00").getTime();
    expect(kstDateMs("2026-02-10")).toBe(expected);
  });
});
