export type SecurityLogLevel = "warn" | "error";

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const normalized = email.trim().toLowerCase();
  const at = normalized.indexOf("@");
  if (at <= 0) return "***";

  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!domain) return "***";

  const head = local.slice(0, 2);
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export function logSecurityEvent(args: {
  level?: SecurityLogLevel;
  message: string;
  requestId: string;
  route: string;
  reason: string;
  actorEmail?: string | null;
  extra?: Record<string, unknown>;
}) {
  const payload = {
    requestId: args.requestId,
    route: args.route,
    reason: args.reason,
    actor: maskEmail(args.actorEmail),
    ...(args.extra ?? {}),
  };

  if (args.level === "error") {
    console.error(`[Security] ${args.message}`, payload);
    return;
  }
  console.warn(`[Security] ${args.message}`, payload);
}
