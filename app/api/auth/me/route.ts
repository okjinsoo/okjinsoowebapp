import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";

export async function GET(request: NextRequest) {
  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
