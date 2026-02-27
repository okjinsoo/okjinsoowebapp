export function getSessionExtraBadgeStyle(badge: string): { background: string; color: string } {
  if (badge === "마지막 수업") {
    return { background: "#ef4444", color: "#fff" };
  }
  if (badge === "환불완료") {
    return { background: "#fecaca", color: "#9f1239" };
  }
  if (badge === "환불요청") {
    return { background: "#fed7aa", color: "#9a3412" };
  }
  return { background: "#f1f5f9", color: "#334155" };
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
