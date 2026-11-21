// v1/lib/ui/session/sessionEffective.ts
"use client";

import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { todayYmdKST } from "@/lib/utils/date";

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
  overrideDurationMin?: number | null;
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

function safeDurationMin(n: unknown): number | null {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return null;
  const mins = Math.floor(x);
  if (mins <= 0) return null;
  return mins;
}

function normalizeOverrideSource(v: unknown): "manual" | "extension" | "" {
  if (v === "manual" || v === "extension") return v;
  return "";
}

// -------------------- meta map (browserStorage) --------------------

export function metaMapKey(token: string) {
  return `tutorweb_metaMap_v1:${token}`;
}

export function buildUpdatedMetaMap(
  token: string,
  index: number,
  patch: Partial<SessionMeta>
): {
  key: string;
  raw: string;
  nextMetaMap: Record<number, SessionMeta>;
  nextMeta: SessionMeta;
} {
  const current = readMetaMap(token);
  const prev = current[index] ?? {};
  const next: SessionMeta = { ...prev, ...patch };

  next.carry = safeInt(next.carry ?? 0, 0);
  next.overrideDate = typeof next.overrideDate === "string" ? next.overrideDate : "";
  next.overrideHour = next.overrideHour === null || next.overrideHour === undefined ? null : safeHour(next.overrideHour);
  next.overrideMinute =
    next.overrideMinute === null || next.overrideMinute === undefined ? null : safeMinute(next.overrideMinute);
  next.overrideDurationMin =
    next.overrideDurationMin === null || next.overrideDurationMin === undefined
      ? null
      : safeDurationMin(next.overrideDurationMin);
  next.overrideSource = normalizeOverrideSource(next.overrideSource);
  next.reason = typeof next.reason === "string" ? next.reason : "";
  next.record = typeof next.record === "string" ? next.record : "";

  const nextMetaMap: Record<number, SessionMeta> = {
    ...current,
    [index]: next,
  };
  const key = metaMapKey(token);
  const raw = JSON.stringify(nextMetaMap);
  return { key, raw, nextMetaMap, nextMeta: next };
}

async function writeMetaMap(token: string, metaMap: Record<number, SessionMeta>) {
  if (typeof window === "undefined") return;
  const key = metaMapKey(token);
  const raw = JSON.stringify(metaMap);
  // 직접 pushSharedSnapshot을 호출하므로 setItemSilent를 사용하여 SharedSnapshotAgent의 700ms 뒤 중복 POST를 차단한다.
  browserStorage.setItemSilent(key, raw);
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.metaMapUpdated, { detail: { token } }));
  const queueRetry = () => {
    window.dispatchEvent(
      new CustomEvent(BROWSER_STORAGE_EVENT, {
        detail: { type: "set", key, oldValue: null, newValue: raw },
      })
    );
  };
  try {
    const result = await pushSharedSnapshot({
      stateKv: {
        [key]: raw,
      },
    });
    if (!result.stateKvSynced) {
      // 서버 반영 실패 시에만 SharedSnapshotAgent 재시도 큐에 태운다.
      queueRetry();
    }
  } catch (err) {
    console.error("공유 스냅샷 동기화 실패(metaMap):", err);
    queueRetry();
  }
}

export function parseMetaMapFromRaw(raw: string | null | undefined): Record<number, SessionMeta> {
  if (!raw) return {};
  try {
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
      merged.overrideDurationMin =
        meta?.overrideDurationMin === null || meta?.overrideDurationMin === undefined
          ? null
          : safeDurationMin(meta.overrideDurationMin);
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

export function readMetaMap(token: string): Record<number, SessionMeta> {
  if (!token) return {};
  try {
    const raw = browserStorage.getItem(metaMapKey(token));
    return parseMetaMapFromRaw(raw);
  } catch {
    return {};
  }
}

export function getEffectiveMetaMap(args: {
  token: string;
  stateKv?: Record<string, string>;
}): Record<number, SessionMeta> {
  const { token, stateKv } = args;
  if (!token) return {};

  const serverRaw = stateKv ? stateKv[metaMapKey(token)] : undefined;
  const serverMeta = parseMetaMapFromRaw(serverRaw);
  const localMeta = readMetaMap(token);

  // 서버 메타와 로컬 메타를 병합 (서버 스냅샷을 우선으로 하되 로컬 오버라이드 보존)
  return {
    ...serverMeta,
    ...localMeta,
  };
}

export async function upsertMeta(token: string, index: number, patch: Partial<SessionMeta>): Promise<SessionMeta> {
  const { nextMetaMap, nextMeta } = buildUpdatedMetaMap(token, index, patch);
  await writeMetaMap(token, nextMetaMap);
  return nextMeta;
}

// -------------------- baseDatesISO --------------------

/**
 * ✅ 원천: Student.startDate + scheduleRules 로 "정확한" baseDatesISO 생성
 * - sessions.displayAt 기반은 12개 이후 extrapolation 때문에 월/수/금 패턴이 깨질 수 있어 사용하지 않음
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function weekdayKSTFromYMD(ymd: string): number | null {
  // ymd = "YYYY-MM-DD" -> T00:00:00Z는 KST 09:00이므로 getUTCDay()가 KST 요일과 정확히 일치한다.
  try {
    const dt = new Date(`${ymd}T00:00:00Z`);
    if (!Number.isFinite(dt.getTime())) return null;
    return dt.getUTCDay();
  } catch {
    return null;
  }
}

function ymdAddDays(ymd: string, days: number): string | null {
  try {
    const dt = new Date(`${ymd}T00:00:00Z`);
    const ms = dt.getTime();
    if (!Number.isFinite(ms)) return null;
    const next = new Date(ms + days * DAY_MS);
    if (!Number.isFinite(next.getTime())) return null;
    const y = String(next.getUTCFullYear()).padStart(4, "0");
    const m = String(next.getUTCMonth() + 1).padStart(2, "0");
    const d = String(next.getUTCDate()).padStart(2, "0");
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
    const ms = dt.getTime();
    if (!Number.isFinite(ms)) return null;
    const kst = new Date(ms + KST_OFFSET_MS);
    const y = String(kst.getUTCFullYear()).padStart(4, "0");
    const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
    const d = String(kst.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  } catch {
    return null;
  }
}

function buildDatesFromRules(startYMD: string, sortedRules: ScheduleRule[], count: number): string[] {
  if (!startYMD || sortedRules.length === 0) return [];

  const out: string[] = [];
  let curYMD: string | null = startYMD;

  for (let guard = 0; guard < 2000 && out.length < count; guard++) {
    if (!curYMD) break;

    const wd = weekdayKSTFromYMD(curYMD);
    if (wd !== null) {
      for (const r of sortedRules) {
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

function buildDatesAfterISO(lastISO: string, sortedRules: ScheduleRule[], count: number): string[] {
  if (!lastISO || sortedRules.length === 0) return [];
  const lastTime = new Date(lastISO).getTime();
  const startYMD = ymdFromISO_KST(lastISO);
  if (!startYMD) return [];

  const out: string[] = [];
  let curYMD: string | null = startYMD;

  for (let guard = 0; guard < 2000 && out.length < count; guard++) {
    if (!curYMD) break;
    const wd = weekdayKSTFromYMD(curYMD);
    if (wd !== null) {
      for (const r of sortedRules) {
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

function buildBaseDatesISOFromRules(
  student: Student,
  count: number,
  metaMapOverride?: Record<number, SessionMeta>
): string[] {
  const startYMD = student.startDate;
  if (!startYMD || count <= 0) return [];

  const rawChanges = Array.isArray(student.scheduleChangeEvents) ? student.scheduleChangeEvents : [];
  const localMetaMap = metaMapOverride ?? readMetaMap(student.token ?? "");

  // 결제/회차 추가 이력(paymentHistory)의 시작 회차별 시작일 매핑
  const rawPayments = Array.isArray(student.paymentHistory) ? student.paymentHistory : [];
  const paymentStartMap = new Map<number, string>();
  for (const p of rawPayments) {
    if (Number.isFinite(p.startIndex) && p.startIndex >= 1) {
      const carryOffset = carrySumUntil(localMetaMap, p.startIndex - 1);
      const baseStart = p.startIndex + carryOffset;
      const startYmd = normalizeYmd(p.sessionAddStartDate || p.paymentDate);
      if (startYmd) {
        paymentStartMap.set(baseStart, startYmd);
      }
    }
  }

  // [최적화] 기본 규칙과 변경 이벤트를 루프 밖에서 단 1회만 정규화·정렬해 재사용한다.
  const defaultRules = normalizeRules(student.scheduleRules ?? []);
  const preparedChanges = rawChanges
    .filter((c) => Number.isFinite(c.startIndex) && c.startIndex >= 1)
    .map((c) => {
      // 법칙이 바뀌는 시점은 그 '회차'가 앉을 '의자' 번호이므로 이전 회차까지의 이월만 합산한다.
      const carryOffset = carrySumUntil(localMetaMap, c.startIndex - 1);
      return {
        baseStartIndex: c.startIndex + carryOffset,
        rules: normalizeRules(c.newRules ?? []),
        minStartYMD: normalizeYmd(c.startDate),
      };
    })
    .sort((a, b) => b.baseStartIndex - a.baseStartIndex); // 큰 인덱스 우선

  const getRulesForBaseIdx = (baseIdx: number) => {
    const paymentMinYMD = paymentStartMap.get(baseIdx + 1) ?? null;

    for (const ch of preparedChanges) {
      if (baseIdx + 1 >= ch.baseStartIndex) {
        return { rules: ch.rules, minStartYMD: paymentMinYMD || ch.minStartYMD };
      }
    }
    return { rules: defaultRules, minStartYMD: paymentMinYMD };
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
export function buildBaseDatesISO(
  student: Student,
  extra = 60,
  metaMapOverride?: Record<number, SessionMeta>
): string[] {
  const pc = Math.max(0, safeInt(student.planCount ?? 0, 0));
  const need = pc + Math.max(0, extra);
  return buildBaseDatesISOFromRules(student, need, metaMapOverride);
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

/**
 * 학생의 현재 활성화된 시간표 규칙(ScheduleRule[])을 결정합니다.
 * - 기본적으로 학생의 기본 시간표(scheduleRules)에서 시작합니다.
 * - scheduleChangeEvents가 있을 경우:
 *   - 1회차부터 적용(startIndex <= 1)인 경우: ch.startDate 당일부터 활성화 (또는 startDate 없으면 즉시)
 *   - N회차부터 적용(startIndex > 1)인 경우:
 *     - 직전 회차(startIndex - 1)의 실제 수업일(prevYmd) 다음날(today > prevYmd)부터 새로운 시간표로 자동 전환됩니다.
 *     - (직전 회차 수업 당일까지는 학생/선생님의 혼란을 방지하기 위해 이전 시간표 유지)
 */
export function resolveActiveScheduleRules(args: {
  student?: Student | null;
  targetYmd?: string;
  baseDatesISO?: string[];
  metaMap?: Record<number, SessionMeta>;
}): ScheduleRule[] {
  const { student, targetYmd, baseDatesISO, metaMap } = args;
  if (!student) return [];
  const defaultRules = Array.isArray(student.scheduleRules) ? student.scheduleRules : [];
  const changes = Array.isArray(student.scheduleChangeEvents) ? student.scheduleChangeEvents : [];
  if (changes.length === 0) return defaultRules;

  const today = (targetYmd || todayYmdKST()).trim();
  const sorted = [...changes].sort((a, b) => a.startIndex - b.startIndex);

  let activeRules: ScheduleRule[] = [...defaultRules];

  // baseDatesISO와 metaMap 준비 (직전 회차 날짜 계산용)
  const computedBaseDates =
    baseDatesISO ?? (student ? buildBaseDatesISO(student, Math.max(60, (student.planCount ?? 20) + 10)) : []);
  const resolvedMetaMap = metaMap ?? (student?.token ? readMetaMap(student.token) : {});

  for (const ch of sorted) {
    if (!Array.isArray(ch.newRules) || ch.newRules.length === 0) continue;

    if (ch.startIndex <= 1) {
      // 1회차부터 적용: 시작일 당일부터 전환 (시작일 없으면 즉시 전환)
      if (ch.startDate && ch.startDate > today) {
        continue;
      }
      activeRules = [...ch.newRules];
    } else {
      // N회차부터 적용: 직전 회차(startIndex - 1)의 다음날부터 전환
      const prevIndex = ch.startIndex - 1;
      let prevYmd: string | null = null;

      try {
        const { effectiveISO } = computeEffectiveISO({
          token: student.token,
          index: prevIndex,
          baseDatesISO: computedBaseDates,
          metaMap: resolvedMetaMap,
        });
        prevYmd = ymdFromISO_KST(effectiveISO ?? "");
      } catch {
        prevYmd = null;
      }

      if (prevYmd) {
        // 직전 회차 날짜의 다음날(today > prevYmd)부터 새 시간표로 전환
        if (today > prevYmd) {
          activeRules = [...ch.newRules];
        }
      } else {
        // fallback: 직전 회차 날짜를 알 수 없는 경우 시작일 기준
        if (!ch.startDate || today >= ch.startDate) {
          activeRules = [...ch.newRules];
        }
      }
    }
  }

  return activeRules.length > 0 ? activeRules : defaultRules;
}
