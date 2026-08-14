import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { filterStudentsForViewer, resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";
import { logPerf, requestIdFromHeaders } from "@/lib/server/performanceLog";

export async function GET(request: NextRequest) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/students";
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

    const students = filterStudentsForViewer(viewer);
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
        students: students.length,
      },
    });
    return NextResponse.json({
      ok: true,
      students,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "students_read_failed";
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
