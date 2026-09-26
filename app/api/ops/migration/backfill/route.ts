import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";
import { backfillNormalizedTables, getNormalizedTableCounts } from "@/lib/server/dualWriteSync";
import { logPerf, requestIdFromHeaders } from "@/lib/server/performanceLog";
import { getSupabaseAnonConfigFromEnv } from "@/lib/security/requestAuth";

function getSupabaseServerConfig() {
  const anonCfg = getSupabaseAnonConfigFromEnv();
  if (!anonCfg) return null;
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return {
    ...anonCfg,
    serviceRoleKey: serviceRoleKey || null,
  };
}

/**
 * GET: 스냅샷 데이터 vs 정규화 테이블 데이터 수량 일치 여부(Parity) 진단
 */
export async function GET(request: NextRequest) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/ops/migration/backfill";

  logPerf({ event: "start", route, requestId, method: request.method });

  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer || viewer.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const cfg = getSupabaseServerConfig();
    const counts = await getNormalizedTableCounts({
      cfg: cfg ?? undefined,
      accessToken: viewer.accessToken,
      useServiceRole: viewer.isLocalDevAdmin,
    });

    const snapshotStudentsCount = viewer.snapshot.students.length;
    const snapshotSessionsCount = viewer.snapshot.sessions.length;

    const isStudentsParity = counts.studentsCount === snapshotStudentsCount;
    const isSessionsParity = counts.sessionsCount === snapshotSessionsCount;
    const isFullParity = isStudentsParity && isSessionsParity;

    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 200,
      startMs,
      extra: {
        isFullParity,
        snapshotStudents: snapshotStudentsCount,
        normalizedStudents: counts.studentsCount,
        snapshotSessions: snapshotSessionsCount,
        normalizedSessions: counts.sessionsCount,
      },
    });

    return NextResponse.json({
      ok: true,
      parity: isFullParity,
      snapshot: {
        studentsCount: snapshotStudentsCount,
        sessionsCount: snapshotSessionsCount,
      },
      normalized: {
        studentsCount: counts.studentsCount,
        sessionsCount: counts.sessionsCount,
      },
      message: isFullParity
        ? "정규화 테이블과 스냅샷 데이터가 100% 일치합니다."
        : "정규화 테이블에 누락된 데이터가 있습니다. POST 요청으로 백필을 실행하세요.",
    });
  } catch (error) {
    console.error("[Migration API Error] backfill GET failed:", error);
    return NextResponse.json({ error: "diagnosis_failed" }, { status: 500 });
  }
}

/**
 * POST: 스냅샷 데이터를 신규 정규화 테이블로 전수 이관(Backfill) 실행
 */
export async function POST(request: NextRequest) {
  const startMs = Date.now();
  const requestId = requestIdFromHeaders(request.headers);
  const route = "/api/ops/migration/backfill";

  logPerf({ event: "start", route, requestId, method: request.method });

  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer || viewer.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const cfg = getSupabaseServerConfig();
    if (!cfg) {
      return NextResponse.json({ error: "supabase_config_missing" }, { status: 500 });
    }

    const result = await backfillNormalizedTables({
      students: viewer.snapshot.students,
      sessions: viewer.snapshot.sessions,
      cfg,
      accessToken: viewer.accessToken,
      useServiceRole: viewer.isLocalDevAdmin,
    });

    logPerf({
      event: "done",
      route,
      requestId,
      method: request.method,
      status: 200,
      startMs,
      extra: {
        studentsBackfilled: result.studentsBackfilled,
        sessionsBackfilled: result.sessionsBackfilled,
        elapsedMs: result.elapsedMs,
      },
    });

    return NextResponse.json({
      ok: true,
      result,
      message: `성공적으로 정규화 테이블 이관 완료: 학생 ${result.studentsBackfilled}/${result.studentsTotal}명, 세션 ${result.sessionsBackfilled}/${result.sessionsTotal}개 (${result.elapsedMs}ms 소요)`,
    });
  } catch (error) {
    console.error("[Migration API Error] backfill POST failed:", error);
    return NextResponse.json({ error: "backfill_failed" }, { status: 500 });
  }
}
