import { describe, expect, it } from "vitest";
import { buildSessionContextBadges, getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";

describe("session badge helpers", () => {
  it("maps session status to label/tone", () => {
    expect(getSessionStatusBadge("present").label).toBe("출석");
    expect(getSessionStatusBadge("absent").label).toBe("결석");
    expect(getSessionStatusBadge("planned").label).toBe("예정");
  });

  it("builds contextual badges in one place", () => {
    const badges = buildSessionContextBadges({
      baseBadges: ["변경"],
      lastClass: true,
      refundStatus: "requested",
    });
    expect(badges).toEqual(["변경", "마지막 수업", "환불요청"]);
  });

  it("returns stable extra badge colors", () => {
    expect(getSessionExtraBadgeStyle("마지막 수업")).toEqual({ background: "#ef4444", color: "#fff" });
    expect(getSessionExtraBadgeStyle("환불완료")).toEqual({ background: "#fecaca", color: "#9f1239" });
    expect(getSessionExtraBadgeStyle("환불요청")).toEqual({ background: "#fed7aa", color: "#9a3412" });
    expect(getSessionExtraBadgeStyle("기타")).toEqual({ background: "#f1f5f9", color: "#334155" });
  });
});
