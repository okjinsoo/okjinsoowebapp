import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";
import { logPerf, requestIdFromHeaders } from "@/lib/server/performanceLog";

export async function GET(request: NextRequest) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/auth/me";
  logPerf({ event: "start", route, requestId, method: request.method });

  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer) {
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
        hasTeacherId: Boolean(viewer.teacherId),
        hasStudentId: Boolean(viewer.studentId),
      },
    });
    return NextResponse.json({
      ok: true,
      user: {
        email: viewer.email,
        userId: viewer.userId,
        role: viewer.role,
        teacherId: viewer.teacherId,
        studentId: viewer.studentId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "auth_me_failed";
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
