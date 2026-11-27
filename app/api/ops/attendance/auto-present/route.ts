import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { runAutoAttendance } from "@/lib/server/autoAttendance";
import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";

export const dynamic = "force-dynamic";

// 매일 00:00 KST(vercel.json 크론): 끝난 '예정' 회차를 '출석'으로. ?dryRun=1 이면 개수만 셈
async function isAuthorized(request: NextRequest): Promise<boolean> {
  const auth = (request.headers.get("authorization") ?? "").trim();
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const cronSecret = (process.env.CRON_BACKUP_SECRET ?? process.env.CRON_SECRET ?? "").trim();
  if (cronSecret && token === cronSecret) return true;

  // 운영 중 수동 실행(미리 세기 포함)을 위해 관리자 계정도 허용
  const viewer = await resolveViewerContext(request);
  return viewer?.role === "admin";
}

export async function GET(request: NextRequest) {
  try {
    if (!(await isAuthorized(request))) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
    const result = await runAutoAttendance({ dryRun });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "auto_attendance_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
