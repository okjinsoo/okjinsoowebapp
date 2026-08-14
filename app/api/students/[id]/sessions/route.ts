import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canReadStudent, filterSessionsForStudent, resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";
import { logPerf, requestIdFromHeaders } from "@/lib/server/performanceLog";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/students/[id]/sessions";
  logPerf({ event: "start", route, requestId, method: request.method });

  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer || viewer.role === "guest") {
      logPerf({
        event: "done",
        route,
        requestId,
        method: request.method,
        status: 401,
        startMs,
        extra: { result: "unauthorized" },
      });
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!canReadStudent(viewer, id)) {
      logPerf({
        event: "done",
        route,
        requestId,
        method: request.method,
        status: 403,
        startMs,
        extra: { result: "forbidden", role: viewer.role },
      });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const sessions = filterSessionsForStudent(viewer, id);
    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 200,
      startMs,
      extra: {
        result: "ok",
        role: viewer.role,
        sessions: sessions.length,
      },
    });
    return NextResponse.json({
      ok: true,
      sessions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "sessions_read_failed";
    logPerf({
      event: "error",
      route,
      requestId,
      method: request.method,
      status: 500,
      startMs,
      error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
