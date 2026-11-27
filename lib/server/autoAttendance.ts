import "server-only";

import {
  buildBaseDatesISOFromMetaMap,
  computeEffectiveISO,
  metaMapKey,
  parseMetaMapFromRaw,
} from "@/lib/factories/sessionEffectiveCore";
import {
  resolveDurationMinForSessionWithMeta,
  resolveRulesForIndex,
} from "@/lib/factories/sessionScheduleResolver";
import { fetchMainSnapshotAsAdmin, getSupabaseAdminConfig } from "@/lib/server/supabaseAdmin";
import type { Student } from "@/lib/types/index";

export type AutoAttendanceChange = { token: string; name: string; indices: number[] };

/**
 * 끝난 회차 중 출결이 비어 있는(예정) 회차를 '출석'으로 바꾼 metaMap 패치를 만듭니다.
 * - 재학(active) 학생만, 1..planCount 회차만 (화면 useStudentRegistry와 같은 범위)
 * - 이미 출석/결석인 회차와 다른 필드(이월·변경 등)는 그대로 둡니다.
 */
export function planAutoAttendance(args: {
  students: Student[];
  stateKv: Record<string, string>;
  nowMs: number;
}): { patch: Record<string, string>; changes: AutoAttendanceChange[] } {
  const patch: Record<string, string> = {};
  const changes: AutoAttendanceChange[] = [];

  for (const st of args.students) {
    if (!st?.token || st.status !== "active") continue;
    const key = metaMapKey(st.token);
    const rawText = args.stateKv[key] ?? "";
    const metaMap = parseMetaMapFromRaw(rawText);
    const baseDatesISO = buildBaseDatesISOFromMetaMap(st, 60, metaMap);
    const planCount = st.planCount || 12;

    const indices: number[] = [];
    for (let index = 1; index <= planCount; index += 1) {
      const { effectiveISO, meta } = computeEffectiveISO({ token: st.token, index, baseDatesISO, metaMap });
      if (!effectiveISO) continue;
      if (meta.status === "present" || meta.status === "absent") continue;
      const startMs = Date.parse(effectiveISO);
      if (!Number.isFinite(startMs)) continue;
      const durationMin = resolveDurationMinForSessionWithMeta(effectiveISO, resolveRulesForIndex(st, index), meta);
      if (startMs + durationMin * 60_000 > args.nowMs) continue;
      indices.push(index);
    }
    if (indices.length === 0) continue;

    // 원본 JSON을 그대로 살리고 status만 바꿔서, 모르는 필드가 사라지지 않게 함
    let raw: Record<string, Record<string, unknown>> = {};
    try {
      const parsed = rawText ? JSON.parse(rawText) : {};
      if (parsed && typeof parsed === "object") raw = parsed;
    } catch {
      continue; // 깨진 데이터는 건드리지 않음
    }
    for (const index of indices) {
      const prev = raw[String(index)];
      raw[String(index)] = { ...(prev && typeof prev === "object" ? prev : {}), status: "present" };
    }
    patch[key] = JSON.stringify(raw);
    changes.push({ token: st.token, name: st.name, indices });
  }

  return { patch, changes };
}

export type AutoAttendanceResult = {
  ok: boolean;
  dryRun: boolean;
  studentCount: number;
  sessionCount: number;
  changes: AutoAttendanceChange[];
  message: string;
};

export async function runAutoAttendance(opts: { dryRun: boolean; nowMs?: number }): Promise<AutoAttendanceResult> {
  const empty = { studentCount: 0, sessionCount: 0, changes: [] as AutoAttendanceChange[] };
  const config = getSupabaseAdminConfig();
  if (!config) {
    return { ok: false, dryRun: opts.dryRun, ...empty, message: "환경변수 누락: Supabase URL 또는 service role 키" };
  }

  const snapshot = await fetchMainSnapshotAsAdmin(config);
  if (!snapshot) return { ok: false, dryRun: opts.dryRun, ...empty, message: "스냅샷을 읽지 못함" };

  const { patch, changes } = planAutoAttendance({
    students: snapshot.students,
    stateKv: snapshot.stateKv,
    nowMs: opts.nowMs ?? Date.now(),
  });
  const summary = {
    studentCount: changes.length,
    sessionCount: changes.reduce((sum, c) => sum + c.indices.length, 0),
    changes,
  };
  if (opts.dryRun || changes.length === 0) {
    return { ok: true, dryRun: opts.dryRun, ...summary, message: opts.dryRun ? "미리 세기만 함(저장 안 함)" : "바꿀 회차 없음" };
  }

  // 원자적 부분 병합 RPC만 사용 (실패 시 전체 덮어쓰기 대체 경로는 쓰지 않음)
  const rpcUrl = new URL("/rest/v1/rpc/patch_snapshot_state_kv", config.url);
  const res = await fetch(rpcUrl.toString(), {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p_snapshot_id: "main", p_patch: patch, p_drop_keys: [] }),
    cache: "no-store",
  });
  const saved = res.ok && (await res.json()) === true;
  if (!saved) {
    return { ok: false, dryRun: false, ...summary, message: `저장 실패: ${res.status}` };
  }
  return { ok: true, dryRun: false, ...summary, message: "출석 처리 완료" };
}
