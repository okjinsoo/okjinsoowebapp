import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  fetchMainSnapshotAsAdmin,
  getSupabaseAdminConfig,
} from "@/lib/server/supabaseAdmin";
import { syncLearningSheetForTeacher } from "@/lib/server/learningSheet/syncFactory";

export const dynamic = "force-dynamic";

const TEACHER_SHEET_MAP_PREFIX = "tutorweb_learning_sheet_teacher_v1:";

function authHeaderToken(request: NextRequest): string {
  const auth = (request.headers.get("authorization") ?? "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

type SyncBySheetBody = {
  spreadsheetId?: string;
  tabTitle?: string;
};

type TeacherSheetMap = {
  teacherId?: string;
  spreadsheetId?: string;
};

function resolveTeacherIdBySpreadsheetId(args: {
  stateKv: Record<string, string>;
  spreadsheetId: string;
}): string | null {
  for (const [key, value] of Object.entries(args.stateKv)) {
    if (!key.startsWith(TEACHER_SHEET_MAP_PREFIX)) continue;
    let row: TeacherSheetMap | null = null;
    try {
      row = JSON.parse(value) as TeacherSheetMap;
    } catch {
      row = null;
    }
    const mappedSpreadsheetId = (row?.spreadsheetId ?? "").trim();
    const teacherId = (row?.teacherId ?? "").trim();
    if (!mappedSpreadsheetId || !teacherId) continue;
    if (mappedSpreadsheetId === args.spreadsheetId) return teacherId;
  }
  return null;
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const token = authHeaderToken(request);
  const secret = (
    process.env.LEARNING_SHEET_MENU_SECRET ??
    process.env.CRON_LEARNING_SHEET_SECRET ??
    process.env.CRON_BACKUP_SECRET ??
    ""
  ).trim();
  return Boolean(secret) && token === secret;
}

export async function POST(request: NextRequest) {
  try {
    const ok = await isAuthorized(request);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as SyncBySheetBody;
    const spreadsheetId = (body.spreadsheetId ?? "").trim();
    const tabTitle = (body.tabTitle ?? "").trim();

    if (!spreadsheetId || !tabTitle) {
      return NextResponse.json(
        { ok: false, error: "spreadsheetId_tabTitle_required" },
        { status: 400 }
      );
    }

    const cfg = getSupabaseAdminConfig();
    if (!cfg) {
      return NextResponse.json(
        { ok: false, error: "supabase_admin_config_missing" },
        { status: 500 }
      );
    }

    const snapshot = await fetchMainSnapshotAsAdmin(cfg);
    if (!snapshot) {
      return NextResponse.json({ ok: false, error: "snapshot_not_found" }, { status: 500 });
    }

    const teacherId = resolveTeacherIdBySpreadsheetId({
      stateKv: snapshot.stateKv,
      spreadsheetId,
    });
    if (!teacherId) {
      return NextResponse.json({ ok: false, error: "teacher_map_not_found" }, { status: 404 });
    }

    const teacher = snapshot.teachers.find((row) => row.id === teacherId) ?? null;
    if (!teacher) {
      return NextResponse.json({ ok: false, error: "teacher_not_found" }, { status: 404 });
    }

    const result = await syncLearningSheetForTeacher({
      teacher,
      students: snapshot.students,
      sessions: snapshot.sessions,
      stateKv: snapshot.stateKv,
      onlyTabTitle: tabTitle,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "learning_sheet_sync_by_sheet_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
