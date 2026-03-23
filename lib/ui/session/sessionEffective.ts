// v1/lib/ui/session/sessionEffective.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";

import type { ScheduleRule, Student } from "@/lib/types/index";

/**
 * ✅ 단일화 규칙(고정)
 * - 원천 데이터: student + sessions + metaMap
 * - baseDatesISO: buildBaseDatesISO(student)만 사용
 * - 날짜 계산: computeEffectiveISO()만 사용
 * - 배지 계산: buildBadges()만 사용
 * - 저장: upsertMeta()만 사용 (직접 browserStorage set 금지)
 *
 * ✅ carry 규칙(확정)
 * - i회차 carry는 "i회차부터" 바로 반영됨
 * - 즉, i회차 base 참조는 (1..i carry 합)만큼 앞으로 당겨짐(스킵)
 *
 * ✅ override 규칙(확정)
 * - overrideDate가 있으면 그 일시가 최우선
 * - 시간은 HH:MM 입력, 저장 시 초는 00초로 기록
 *
 * ✅ 사유 규칙(확정)
 * - 결석(absent) 또는 carry>0 또는 변경(overrideDate)일 때 reason은 필수
 */

// -------------------- Meta types --------------------

export type SessionState = "planned" | "present" | "absent";

export type SessionMeta = {
  status?: SessionState;

  carry?: number;

  overrideDate?: string;
  overrideHour?: number | null;
  overrideMinute?: number | null;
  overrideSource?: "manual" | "extension" | "";

  reason?: string;
  record?: string;
};

const SESSION_STATUS_BADGE_STYLES = {
  present: { bg: "#2563eb", text: "#ffffff", border: "#2563eb" }, // 출석: 파란색
  absent: { bg: "#dc2626", text: "#ffffff", border: "#dc2626" }, // 결석: 빨간색
  planned: { bg: "#64748b", text: "#ffffff", border: "#64748b" },
} as const;

export function getStatusStyle(status?: SessionState): { bg: string; text: string; border: string } {
  if (status === "present") return SESSION_STATUS_BADGE_STYLES.present;
  if (status === "absent") return SESSION_STATUS_BADGE_STYLES.absent;
  return SESSION_STATUS_BADGE_STYLES.planned;
}

// -------------------- utils --------------------

function safeInt(n: unknown, fallback = 0) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  const m = Math.floor(x);
  if (m < 0) return fallback;
  return m;
}

function safeHour(n: unknown): number | null {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  const h = Math.floor(x);
  if (h < 0 || h > 23) return null;
  return h;
}

function safeMinute(n: unknown): number | null {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  const m = Math.floor(x);
  if (m < 0 || m > 59) return null;
  return m;
}

function normalizeOverrideSource(v: unknown): "manual" | "extension" | "" {
  if (v === "manual" || v === "extension") return v;
  return "";
}

// -------------------- meta map (browserStorage) --------------------

export function metaMapKey(token: string) {
  return `tutorweb_metaMap_v1:${token}`;
}

async function writeMetaMap(token: string, metaMap: Record<number, SessionMeta>) {
  if (typeof window === "undefined") return;
  const key = metaMapKey(token);
  const raw = JSON.stringify(metaMap);
  browserStorage.setItem(key, raw);
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
  try {
    await pushSharedSnapshot({
      stateKv: {
        [key]: raw,
      },
    });
  } catch (err) {
    console.error("공유 스냅샷 동기화 실패(metaMap):", err);
  }
}

export function readMetaMap(token: string): Record<number, SessionMeta> {
  if (!token) return {};
  try {
    const raw = browserStorage.getItem(metaMapKey(token));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const out: Record<number, SessionMeta> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const idx = Number(k);
      if (!Number.isFinite(idx)) continue;

      const meta = toMeta(v);

      const merged: SessionMeta = {};
      merged.status = isSessionState(meta?.status) ? meta?.status : undefined;
      merged.carry = safeInt(meta?.carry ?? 0, 0);
      merged.overrideDate = typeof meta?.overrideDate === "string" ? meta.overrideDate : "";
      merged.overrideHour =
        meta?.overrideHour === null || meta?.overrideHour === undefined ? null : safeHour(meta.overrideHour);
      merged.overrideMinute =
        meta?.overrideMinute === null || meta?.overrideMinute === undefined ? null : safeMinute(meta.overrideMinute);
      merged.overrideSource = normalizeOverrideSource(meta?.overrideSource);
      merged.reason = typeof meta?.reason === "string" ? meta.reason : "";
      merged.record = typeof meta?.record === "string" ? meta.record : "";

      out[idx] = merged;
    }
    return out;
  } catch {
    return {};
  }
}

export async function upsertMeta(token: string, index: number, patch: Partial<SessionMeta>): Promise<SessionMeta> {
  const current = readMetaMap(token);
  const prev = current[index] ?? {};
  const next: SessionMeta = { ...prev, ...patch };

  next.carry = safeInt(next.carry ?? 0, 0);
  next.overrideDate = typeof next.overrideDate === "string" ? next.overrideDate : "";
  next.overrideHour = next.overrideHour === null || next.overrideHour === undefined ? null : safeHour(next.overrideHour);
  next.overrideMinute =
    next.overrideMinute === null || next.overrideMinute === undefined ? null : safeMinute(next.overrideMinute);
  next.overrideSource = normalizeOverrideSource(next.overrideSource);
  next.reason = typeof next.reason === "string" ? next.reason : "";
  next.record = typeof next.record === "string" ? next.record : "";

  current[index] = next;
  await writeMetaMap(token, current);
  return next;
}

// -------------------- baseDatesISO --------------------

/**
 * ✅ 원천: Student.startDate + scheduleRules 로 "정확한" baseDatesISO 생성
 * - sessions.displayAt 기반은 12개 이후 extrapolation 때문에 월/수/금 패턴이 깨질 수 있어 사용하지 않음
 */

function weekdayKSTFromYMD(ymd: string): number | null {
  // ymd = "YYYY-MM-DD"
  // Intl로 Asia/Seoul 기준 요일을 구한다 (환경 timezone과 무관하게)
  try {
    const dt = new Date(`${ymd}T00:00:00Z`);
    if (!Number.isFinite(dt.getTime())) return null;

    const wk = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      timeZone: "Asia/Seoul",
    }).format(dt);

    // Sun Mon Tue Wed Thu Fri Sat
    const map: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    return map[wk] ?? null;
  } catch {
    return null;
  }
}

function ymdAddDays(ymd: string, days: number): string | null {
  try {
    const dt = new Date(`${ymd}T00:00:00Z`);
    if (!Number.isFinite(dt.getTime())) return null;
    const next = new Date(dt.getTime() + days * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(next.getTime())) return null;

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(next);

    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

function isoFromKST(ymd: string, hour: number, minute: number): string | null {
  // KST(+09:00)로 Date를 만들고 ISO(UTC)로 변환해 저장
  try {
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    const dt = new Date(`${ymd}T${hh}:${mm}:00+09:00`);
    if (!Number.isFinite(dt.getTime())) return null;
    return dt.toISOString();
  } catch {
    return null;
  }
}

function normalizeRules(rules: ScheduleRule[]): ScheduleRule[] {
  const list = Array.isArray(rules) ? rules : [];
  const filtered = list.filter((r) =>
    typeof r.weekday === "number" && typeof r.hour === "number" && typeof r.minute === "number"
  );
  return [...filtered].sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    if (a.hour !== b.hour) return a.hour - b.hour;
    return a.minute - b.minute;
  });
}

export function ymdFromISO_KST(iso: string): string | null {
  try {
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(dt);
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

function buildDatesFromRules(startYMD: string, rules: ScheduleRule[], count: number): string[] {
  if (!startYMD) return [];
  if (rules.length === 0) return [];
  const sorted = normalizeRules(rules);

  const out: string[] = [];
  let curYMD: string | null = startYMD;

  for (let guard = 0; guard < 2000 && out.length < count; guard++) {
    if (!curYMD) break;

    const wd = weekdayKSTFromYMD(curYMD);
    if (wd !== null) {
      for (const r of sorted) {
        if (r.weekday !== wd) continue;
        const iso = isoFromKST(curYMD, r.hour, r.minute);
        if (iso) out.push(iso);
        if (out.length >= count) break;
      }
    }

    curYMD = ymdAddDays(curYMD, 1);
  }

  return out;
}

function buildDatesAfterISO(lastISO: string, rules: ScheduleRule[], count: number): string[] {
  if (!lastISO) return [];
  if (rules.length === 0) return [];
  const sorted = normalizeRules(rules);
  const lastTime = new Date(lastISO).getTime();
  const startYMD = ymdFromISO_KST(lastISO);
  if (!startYMD) return [];

  const out: string[] = [];
  let curYMD: string | null = startYMD;

  for (let guard = 0; guard < 2000 && out.length < count; guard++) {
    if (!curYMD) break;
    const wd = weekdayKSTFromYMD(curYMD);
    if (wd !== null) {
      for (const r of sorted) {
        if (r.weekday !== wd) continue;
        const iso = isoFromKST(curYMD, r.hour, r.minute);
        if (iso) {
          const t = new Date(iso).getTime();
          if (t > lastTime) out.push(iso);
        }
        if (out.length >= count) break;
      }
    }
    curYMD = ymdAddDays(curYMD, 1);
  }

  return out;
}

function normalizeYmd(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = new Date(`${s}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(t)) return null;
  return s;
}

function buildDatesSegment(args: {
  studentStartYMD: string;
  lastISO: string | null;
  rules: ScheduleRule[];
  count: number;
  minStartYMD?: string | null;
}): string[] {
  const { studentStartYMD, lastISO, rules, count, minStartYMD } = args;
  if (count <= 0) return [];

  if (!lastISO) {
    const startYMD = minStartYMD && minStartYMD > studentStartYMD ? minStartYMD : studentStartYMD;
    return buildDatesFromRules(startYMD, rules, count);
  }

  let boundaryISO = lastISO;
  const minYmd = normalizeYmd(minStartYMD);
  if (minYmd) {
    const minIso = isoFromKST(minYmd, 0, 0);
    if (minIso) {
      const minMs = new Date(minIso).getTime();
      const boundaryMs = new Date(boundaryISO).getTime();
      if (Number.isFinite(minMs) && Number.isFinite(boundaryMs) && minMs > boundaryMs) {
        boundaryISO = minIso;
      }
    }
  }

  return buildDatesAfterISO(boundaryISO, rules, count);
}

function buildBaseDatesISOFromRules(student: Student, count: number): string[] {
  const startYMD = student.startDate;
  if (!startYMD || count <= 0) return [];

  const rawChanges = Array.isArray(student.scheduleChangeEvents) ? student.scheduleChangeEvents : [];
  const localMetaMap = readMetaMap(student.token ?? "");

  // 규칙 조회를 위한 도우미 함수 (특정 베이스 인덱스가 어떤 규칙을 따르는지 결정)
  const getRulesForBaseIdx = (baseIdx: number) => {
    // 1. 역순으로 변화 이벤트를 확인하여 해당 인덱스에 걸리는 최신 규칙을 찾음
    // baseIdx는 0-based 포인트이므로, 실제 세션 index와 비교할 때는 index = baseIdx + 1 - carry 가 필요하지만,
    // 여기서는 단순히 '법칙이 적용되는 시점'인 baseStartIndex와 비교합니다.
    
    // changes를 미리 가공
    const changes = rawChanges
      .filter((c) => Number.isFinite(c.startIndex) && c.startIndex >= 1)
      .map((c) => {
        // 법칙이 바뀌는 시점은 그 '회차'가 앉을 '의자' 번호입니다.
        // 이때 해당 회차 자체의 이월은 의자 번호를 결정하는 변수이지, 법칙의 경계를 가르는 변수가 아니어야 합니다.
        // 따라서 이전 회차까지의 이월만 합산합니다.
        const carryOffset = carrySumUntil(localMetaMap, c.startIndex - 1);
        return {
          ...c,
          baseStartIndex: c.startIndex + carryOffset,
          rules: normalizeRules(c.newRules ?? []),
        };
      })
      .sort((a, b) => b.baseStartIndex - a.baseStartIndex); // 큰 인덱스 우선

    for (const ch of changes) {
      if (baseIdx + 1 >= ch.baseStartIndex) {
        return { rules: ch.rules, minStartYMD: normalizeYmd(ch.startDate) };
      }
    }
    return { rules: normalizeRules(student.scheduleRules ?? []), minStartYMD: null };
  };

  const out: string[] = [];
  let lastISO: string | null = null;

  for (let i = 0; i < count; i++) {
    const { rules, minStartYMD } = getRulesForBaseIdx(i);
    if (rules.length === 0) break;

    // 현재 인덱스(i) 하나에 대한 날짜 생성
    const segment = buildDatesSegment({
      studentStartYMD: startYMD,
      lastISO,
      rules,
      count: 1,
      minStartYMD,
    });

    if (segment.length === 0) break;
    const iso = segment[0];
    out.push(iso);
    lastISO = iso;
  }

  return out;
}

/**
 * ✅ 이제 baseDatesISO는 sessions.displayAt이 아니라 규칙 기반으로 만든다.
 * - planCount만 생성하면 carry 때문에 더 뒤가 필요할 수 있으니, "여유분"을 함께 만든다.
 */
export function buildBaseDatesISO(student: Student, extra = 60): string[] {
  const pc = Math.max(0, safeInt(student.planCount ?? 0, 0));
  const need = pc + Math.max(0, extra);
  return buildBaseDatesISOFromRules(student, need);
}

function toMeta(v: unknown): Partial<SessionMeta> | null {
  if (!v || typeof v !== "object") return null;
  return v as Partial<SessionMeta>;
}

function isSessionState(v: unknown): v is SessionState {
  return v === "present" || v === "absent" || v === "planned";
}


// -------------------- computeEffectiveISO --------------------
function carrySumUntil(metaMap: Record<number, SessionMeta>, index: number): number {
  let sum = 0;
  for (let i = 1; i <= index; i++) sum += safeInt(metaMap[i]?.carry ?? 0, 0);
  return sum;
}


/**
 * baseDatesISO가 부족해서 baseIdx가 넘어가면,
 * "마지막 두 세션의 간격"으로 뒤 날짜를 이어서 만들어줍니다.
 * (마지막 간격을 모르면 7일로 가정)
 */
function getBaseISOWithExtrapolation(baseDatesISO: string[], baseIdx: number): string | null {
  if (baseIdx < 0) return null;
  if (baseIdx < baseDatesISO.length) return baseDatesISO[baseIdx] ?? null;

  // baseDatesISO가 1개도 없으면 계산 불가
  if (baseDatesISO.length === 0) return null;

  // 마지막 날짜
  const lastISO = baseDatesISO[baseDatesISO.length - 1];
  const lastDT = new Date(lastISO);
  if (!Number.isFinite(lastDT.getTime())) return null;

  // 간격(기본 7일)
  let stepMs = 7 * 24 * 60 * 60 * 1000;

  if (baseDatesISO.length >= 2) {
    const prevISO = baseDatesISO[baseDatesISO.length - 2];
    const prevDT = new Date(prevISO);
    if (Number.isFinite(prevDT.getTime())) {
      const diff = lastDT.getTime() - prevDT.getTime();
      // 너무 이상한 값이면(0 이하 등) fallback
      if (diff > 0) stepMs = diff;
    }
  }

  const extra = baseIdx - (baseDatesISO.length - 1);
  const next = new Date(lastDT.getTime() + stepMs * extra);
  if (!Number.isFinite(next.getTime())) return null;
  return next.toISOString();
}

export function computeEffectiveISO(args: {
  token: string;
  index: number; // 1-based
  baseDatesISO: string[];
  metaMap: Record<number, SessionMeta>;
}): { effectiveISO: string | null; meta: SessionMeta; baseISO: string | null } {
  const { index, baseDatesISO, metaMap } = args;
  const meta = metaMap[index] ?? {};

  const skip = carrySumUntil(metaMap, index);
  const baseIdx = index - 1 + skip;

  const baseISO = getBaseISOWithExtrapolation(baseDatesISO, baseIdx);

  // ✅ override 우선순위 결정
  // 1. manual(조정으로 직접 설정): 이월/시간표 변경과 무관하게 항상 최우선 (기존 법을 어기는 예외)
  // 2. extension(결제 자동 생성): 
  //    - 이월(carry)이 적용되었거나, 시간표 변경으로 날짜(YMD)가 달라졌다면 가차 없이 무시 (법 우선)
  if (meta.overrideDate) {
    const isManual = meta.overrideSource === "manual";
    const baseISO_YMD = ymdFromISO_KST(baseISO ?? "");
    const dateMatch = baseISO_YMD === meta.overrideDate;
    const carryApplied = skip > 0;

    if (isManual || (!carryApplied && dateMatch)) {
      const h = meta.overrideHour ?? 0;
      const m = meta.overrideMinute ?? 0;
      const iso = isoFromKST(meta.overrideDate, h, m);
      if (iso) return { effectiveISO: iso, meta, baseISO };
    }
  }

  return { effectiveISO: baseISO, meta, baseISO };
}

// -------------------- badges --------------------

export function buildBadges(meta: SessionMeta): string[] {
  const out: string[] = [];

  // ✅ 출결은 배지에서 제외 (UI에서 별도 칩으로 강하게 표시)
  const carry = safeInt(meta.carry ?? 0, 0);
  if (carry > 0) out.push(`이월+${carry}`);
  // '변경' 배지는 선생님이 직접 손으로 바꾼(manual) 경우에만 노출합니다.
  if (meta.overrideDate && meta.overrideSource === "manual") {
    out.push("변경");
  }

  return out;
}
