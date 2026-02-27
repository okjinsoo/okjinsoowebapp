import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { filterStudentsForViewer, resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";

export async function GET(request: NextRequest) {
  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer || viewer.role === "guest") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      students: filterStudentsForViewer(viewer),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "students_read_failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
