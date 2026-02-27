import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canReadStudent, readConsultationsForStudent, resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer || viewer.role === "guest") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!canReadStudent(viewer, id)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      consultations: readConsultationsForStudent(viewer, id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "consultations_read_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
