type PerfEvent = "start" | "done" | "error";

type PerfExtra = Record<string, string | number | boolean | null | undefined>;

type PerfLogArgs = {
  event: PerfEvent;
  route: string;
  requestId?: string | null;
  method?: string | null;
  status?: number;
  startMs?: number;
  error?: unknown;
  extra?: PerfExtra;
};

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function requestIdFromHeaders(headers: Headers): string {
  return (
    headers.get("x-vercel-id") ??
    headers.get("x-request-id") ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function logPerf(args: PerfLogArgs): void {
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") return;

  const ms = typeof args.startMs === "number" ? Date.now() - args.startMs : undefined;
  const payload = {
    tag: "tutorweb_perf",
    level: args.event === "error" ? "error" : "info",
    event: args.event,
    route: args.route,
    requestId: args.requestId ?? null,
    method: args.method ?? null,
    status: args.status,
    ms,
    error: errorMessage(args.error),
    ...(args.extra ?? {}),
  };

  const line = JSON.stringify(payload);
  if (args.event === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}
