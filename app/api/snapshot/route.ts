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

    const stateKey = request.nextUrl.searchParams.get("stateKey")?.trim() ?? "";
    if (stateKey) {
      return NextResponse.json({
        ok: true,
        value: viewer.snapshot.stateKv[stateKey] ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      snapshot: {
        teachers: viewer.snapshot.teachers,
        students: viewer.snapshot.students,
        sessions: viewer.snapshot.sessions,
        stateKv: viewer.snapshot.stateKv,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "snapshot_read_failed";
    return NextResponse.json({ error: message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : "snapshot_write_failed";
    const status = message === "unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
