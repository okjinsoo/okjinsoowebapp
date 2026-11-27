export function getSessionExtraBadgeStyle(badge: string): { background: string; color: string } {
  if (badge === "마지막 수업") {
    return { background: "var(--wait)", color: "#fff" };
  }
  if (badge === "환불완료") {
    return { background: "var(--quiet)", color: "#fff" };
  }
  if (badge === "환불요청") {
    return { background: "var(--alert)", color: "#fff" };
  }
  return { background: "var(--surface-hover)", color: "var(--text-subtle)" };
}

export function buildSessionContextBadges(args: {
  baseBadges?: string[];
  lastClass?: boolean;
  refundStatus?: "requested" | "completed" | null;
}): string[] {
  const out = [...(args.baseBadges ?? [])];
  if (args.lastClass) out.push("마지막 수업");
  if (args.refundStatus === "completed") out.push("환불완료");
  if (args.refundStatus === "requested") out.push("환불요청");
  return out;
}
