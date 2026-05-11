import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  fetchMainSnapshotAsAdmin,
  getSupabaseAdminConfig,
} from "@/lib/server/supabaseAdmin";
import { syncLearningSheetsForAllTeachers } from "@/lib/server/learningSheet/syncFactory";
import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";

export const dynamic = "force-dynamic";

function authHeaderToken(request: NextRequest): string {
  const auth = (request.headers.get("authorization") ?? "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const token = authHeaderToken(request);
  const cronSecret = (
    process.env.CRON_LEARNING_SHEET_SECRET ??
    process.env.CRON_BACKUP_SECRET ??
    process.env.CRON_SECRET ??
    ""
  ).trim();
  if (cronSecret && token === cronSecret) return true;

  const viewer = await resolveViewerContext(request);
  return viewer?.role === "admin";
}

async function handle(request: NextRequest) {
  const ok = await isAuthorized(request);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const cfg = getSupabaseAdminConfig();
  if (!cfg) {
    return NextResponse.json(
      {
        ok: false,
        error: "supabase_admin_config_missing",
      },
      { status: 500 }
    );
  }

  const snapshot = await fetchMainSnapshotAsAdmin(cfg);
  if (!snapshot) {
    return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 500 });
  }

  const results = await syncLearningSheetsForAllTeachers({
    teachers: snapshot.teachers,
    students: snapshot.students,
    sessions: snapshot.sessions,
    stateKv: snapshot.stateKv,
  });

  const totalRows = results.reduce((sum, row) => sum + row.rowsWritten, 0);
  const totalStudents = results.reduce((sum, row) => sum + row.syncedStudentCount, 0);

  return NextResponse.json({
    ok: true,
    teacherCount: results.length,
    syncedStudentCount: totalStudents,
    rowsWritten: totalRows,
    results,
  });
}

export async function GET(request: NextRequest) {
  try {
    return await handle(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "learning_sheet_weekly_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
