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

  it("shows submission as percent and never uses red", () => {
    expect(getSubmissionBadge(null, false).label).toBe("미정");
    expect(getSubmissionBadge({ done: 0, total: 0, hasNotice: true }, true).label).toBe("공지");
    expect(getSubmissionBadge({ done: 0, total: 0 }, true).label).toBe("미정");
    expect(getSubmissionBadge({ done: 0, total: 4 }, false)).toEqual({
      label: "0%",
      style: { background: "var(--quiet)", color: "#ffffff" },
    });
    expect(getSubmissionBadge({ done: 3, total: 4 }, true)).toEqual({
      label: "75%",
      style: { background: "var(--wait)", color: "#ffffff" },
    });
    expect(getSubmissionBadge({ done: 4, total: 4 }, true).style.background).toBe("var(--ok)");
    expect(getSubmissionBadge({ done: 4, total: 4 }, false).style.background).toBe("var(--ok)");
  });
});
