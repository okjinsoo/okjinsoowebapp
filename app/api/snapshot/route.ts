import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext, upsertSnapshotPatch } from "@/lib/server/supabaseSnapshotApi";
import type { Session, Student, Teacher } from "@/lib/types/index";

export async function GET(request: NextRequest) {
  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const clientDigest = request.nextUrl.searchParams.get("digest")?.trim();
    if (clientDigest && clientDigest === viewer.digest) {
      return NextResponse.json({
        ok: true,
        changed: false,
        digest: viewer.digest,
      });
    }

    const stateKey = request.nextUrl.searchParams.get("stateKey")?.trim() ?? "";
    if (stateKey) {
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
    console.error("[API Error] Snapshot GET failed:", error);
    return NextResponse.json({ error: "request_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[API Error] Snapshot POST failed:", error);
    const message = error instanceof Error ? error.message : "";
    const status = message.includes("unauthorized") ? 401 : 500;
    const clientMessage = status === 401 ? "unauthorized" : "update_failed";
    return NextResponse.json({ error: clientMessage }, { status });
  }
}
