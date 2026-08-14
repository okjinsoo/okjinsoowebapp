import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext, upsertSnapshotPatch } from "@/lib/server/supabaseSnapshotApi";
import { logPerf, requestIdFromHeaders } from "@/lib/server/performanceLog";
import type { Session, Student, Teacher } from "@/lib/types/index";

export async function GET(request: NextRequest) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/snapshot";
  const stateKey = request.nextUrl.searchParams.get("stateKey")?.trim() ?? "";
  const hasClientDigest = Boolean(request.nextUrl.searchParams.get("digest")?.trim());
  logPerf({
    event: "start",
    route,
    requestId,
    method: request.method,
    extra: { stateKey: Boolean(stateKey), hasClientDigest },
  });

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

    const clientDigest = request.nextUrl.searchParams.get("digest")?.trim();
    if (clientDigest && clientDigest === viewer.digest) {
      logPerf({
        event: "done",
        route,
        requestId,
        method: request.method,
        status: 200,
        startMs,
        extra: {
          result: "not_changed",
          role: viewer.role,
          teachers: 0,
          students: 0,
          sessions: 0,
          stateKvKeys: 0,
        },
      });
      return NextResponse.json({
        ok: true,
        changed: false,
        digest: viewer.digest,
      });
    }

    if (stateKey) {
      logPerf({
        event: "done",
        route,
        requestId,
        method: request.method,
        status: 200,
        startMs,
        extra: {
          result: "state_key",
          role: viewer.role,
          hasValue: Object.prototype.hasOwnProperty.call(viewer.snapshot.stateKv, stateKey),
        },
      });
      return NextResponse.json({
        ok: true,
        changed: true,
        digest: viewer.digest,
        value: viewer.snapshot.stateKv[stateKey] ?? null,
      });
    }

    // [V18 최적화] 학생 계정은 본인 데이터만 전송하여 패킷 크기 절감
    const sessions = viewer.role === "student" && viewer.studentId
      ? viewer.snapshot.sessions.filter(s => s.studentId === viewer.studentId)
      : viewer.snapshot.sessions;

    const students = viewer.role === "student" && viewer.studentId
      ? viewer.snapshot.students.filter(s => s.id === viewer.studentId)
      : viewer.snapshot.students;

    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 200,
      startMs,
      extra: {
        result: "snapshot",
        role: viewer.role,
        teachers: viewer.snapshot.teachers.length,
        students: students.length,
        sessions: sessions.length,
        stateKvKeys: Object.keys(viewer.snapshot.stateKv).length,
      },
    });
    return NextResponse.json({
      ok: true,
      changed: true,
      digest: viewer.digest,
      snapshot: {
        teachers: viewer.snapshot.teachers, // 선생님 정보는 학생도 참조하므로 유지
        students,
        sessions,
        stateKv: viewer.snapshot.stateKv,
      },
    });
  } catch (error) {
    logPerf({
      event: "error",
      route,
      requestId,
      method: request.method,
      status: 500,
      startMs,
      error,
    });
    console.error("[API Error] Snapshot GET failed:", error);
    return NextResponse.json({ error: "request_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/snapshot";
  logPerf({
    event: "start",
    route,
    requestId,
    method: request.method,
  });

  try {
    const body = (await request.json()) as {
      teachers?: Teacher[];
      students?: Student[];
      sessions?: Session[];
      stateKv?: Record<string, string>;
      dropStateKeys?: string[];
    };

    const result = await upsertSnapshotPatch({
      request,
      patch: {
        ...(Object.prototype.hasOwnProperty.call(body ?? {}, "teachers") ? { teachers: body.teachers } : {}),
        ...(Object.prototype.hasOwnProperty.call(body ?? {}, "students") ? { students: body.students } : {}),
        ...(Object.prototype.hasOwnProperty.call(body ?? {}, "sessions") ? { sessions: body.sessions } : {}),
        ...(Object.prototype.hasOwnProperty.call(body ?? {}, "stateKv") ? { stateKv: body.stateKv } : {}),
        ...(Object.prototype.hasOwnProperty.call(body ?? {}, "dropStateKeys")
          ? { dropStateKeys: body.dropStateKeys }
          : {}),
      },
    });

    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 200,
      startMs,
      extra: {
        result: "updated",
        teachersPatch: Array.isArray(body?.teachers) ? body.teachers.length : 0,
        studentsPatch: Array.isArray(body?.students) ? body.students.length : 0,
        sessionsPatch: Array.isArray(body?.sessions) ? body.sessions.length : 0,
        stateKvPatchKeys: body?.stateKv ? Object.keys(body.stateKv).length : 0,
        dropStateKeys: Array.isArray(body?.dropStateKeys) ? body.dropStateKeys.length : 0,
        sessionsSynced: result.sessionsSynced,
        stateKvSynced: result.stateKvSynced,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[API Error] Snapshot POST failed:", error);
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("unauthorized") ? 401 : 500;
    const clientMessage = status === 401 ? "unauthorized" : "update_failed";
    logPerf({
      event: "error",
      route,
      requestId,
      method: request.method,
      status,
      startMs,
      error,
    });
    return NextResponse.json({ error: clientMessage }, { status });
  }
}
