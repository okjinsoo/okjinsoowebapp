import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runDailySnapshotBackup } from "@/lib/server/snapshotBackup";
import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";

export const dynamic = "force-dynamic";

function authHeaderToken(request: NextRequest): string {
  const auth = (request.headers.get("authorization") ?? "").trim();
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const token = authHeaderToken(request);
  const cronSecret = (process.env.CRON_BACKUP_SECRET ?? process.env.CRON_SECRET ?? "").trim();
  if (cronSecret && token === cronSecret) return true;

  // 운영 중 수동 실행을 위해 관리자 계정도 허용
  const viewer = await resolveViewerContext(request);
  return viewer?.role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    const ok = await isAuthorized(request);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const result = await runDailySnapshotBackup("daily_cron");
    const status = result.ok ? 200 : 500;
    return NextResponse.json(result, { status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "daily_backup_route_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}

