import { describe, expect, it } from "vitest";
import { buildSessionContextBadges, getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";
import { getSubmissionBadge } from "@/lib/ui/common/achievementBadgeStyle";

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
    expect(getSessionExtraBadgeStyle("마지막 수업")).toEqual({ background: "var(--wait)", color: "#fff" });
    expect(getSessionExtraBadgeStyle("환불완료")).toEqual({ background: "var(--quiet)", color: "#fff" });
    expect(getSessionExtraBadgeStyle("환불요청")).toEqual({ background: "var(--alert)", color: "#fff" });
    expect(getSessionExtraBadgeStyle("기타")).toEqual({ background: "var(--surface-hover)", color: "var(--text-subtle)" });
  });

  it("shows submission as percent with the original 4-step colors", () => {
    expect(getSubmissionBadge(null).label).toBe("미정");
    expect(getSubmissionBadge({ done: 0, total: 0, hasNotice: true }).label).toBe("공지");
    expect(getSubmissionBadge({ done: 0, total: 0 }).label).toBe("미정");
    expect(getSubmissionBadge({ done: 0, total: 4 })).toEqual({
      label: "0%",
      style: { background: "#dc2626", color: "#ffffff" },
    });
    expect(getSubmissionBadge({ done: 3, total: 4 }).style.background).toBe("#ea580c");
    expect(getSubmissionBadge({ done: 9, total: 10 }).style.background).toBe("#2563eb");
    expect(getSubmissionBadge({ done: 4, total: 4 }).style.background).toBe("#16a34a");
  });
});
