// v1/lib/factories/sessionEffectiveCore.ts
// 순수 회차/시간표 계산 엔진 (브라우저 저장소·window·UI 의존 없음)

import type { ScheduleRule, SessionMeta, SessionMetaStatus, Student } from "@/lib/types/index";

/**
 * ✅ 단일화 규칙(고정)
 * - 원천 데이터: student + sessions + metaMap
 * - baseDatesISO: buildBaseDatesISOFromMetaMap(student, extra, metaMap)
 * - 날짜 계산: computeEffectiveISO()
 * - 배지 계산: buildBadges()
 *
 * ✅ carry 규칙(확정)
 * - i회차 carry는 "i회차부터" 바로 반영됨
 * - 즉, i회차 base 참조는 (1..i carry 합)만큼 앞으로 당겨짐(스킵)
 *
 * ✅ override 규칙(확정)
 * - manual overrideDate가 있으면 그 일시가 최우선
 * - 시간은 HH:MM 입력, 저장 시 초는 00초로 기록
 */

const SESSION_STATUS_BADGE_STYLES = {
  present: { bg: "#2563eb", text: "#ffffff", border: "#2563eb" }, // 출석: 파란색
  absent: { bg: "#dc2626", text: "#ffffff", border: "#dc2626" }, // 결석: 빨간색
  planned: { bg: "#64748b", text: "#ffffff", border: "#64748b" },
} as const;

export function getStatusStyle(status?: SessionMetaStatus): { bg: string; text: string; border: string } {
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

function toMeta(v: unknown): Partial<SessionMeta> | null {
  if (!v || typeof v !== "object") return null;
  return v as Partial<SessionMeta>;
}

function isSessionMetaStatus(v: unknown): v is SessionMetaStatus {
  return v === "present" || v === "absent" || v === "planned";
}

// -------------------- meta map (pure) --------------------

export function metaMapKey(token: string) {
  return `tutorweb_metaMap_v1:${token}`;
}

export function buildUpdatedMetaMapFromCurrent(
  current: Record<number, SessionMeta>,
  token: string,
  index: number,
  patch: Partial<SessionMeta>
): {
  key: string;
  raw: string;
  nextMetaMap: Record<number, SessionMeta>;
  nextMeta: SessionMeta;
} {
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
      merged.status = isSessionMetaStatus(meta?.status) ? meta?.status : undefined;
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

/**
 * 서버 메타를 기본으로 두고, 같은 회차에 로컬 변경이 있으면 로컬 값을 우선 병합합니다.
 */
export function mergeEffectiveMetaMap(
  serverMeta: Record<number, SessionMeta>,
  localMeta: Record<number, SessionMeta>
): Record<number, SessionMeta> {
  return {
    ...serverMeta,
    ...localMeta,
  };
}

// -------------------- baseDatesISO (pure) --------------------

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
  const filtered = list.filter(
    (r) => typeof r.weekday === "number" && typeof r.hour === "number" && typeof r.minute === "number"
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

function carrySumUntil(metaMap: Record<number, SessionMeta>, index: number): number {
  let sum = 0;
  for (let i = 1; i <= index; i++) sum += safeInt(metaMap[i]?.carry ?? 0, 0);
  return sum;
}

function buildBaseDatesISOFromRulesPure(
  student: Student,
  count: number,
  metaMap: Record<number, SessionMeta>
): string[] {
  const startYMD = student.startDate;
  if (!startYMD || count <= 0) return [];

  const rawChanges = Array.isArray(student.scheduleChangeEvents) ? student.scheduleChangeEvents : [];

  // 결제/회차 추가 이력(paymentHistory)의 시작 회차별 시작일 매핑
  const rawPayments = Array.isArray(student.paymentHistory) ? student.paymentHistory : [];
  const paymentStartMap = new Map<number, string>();
  for (const p of rawPayments) {
    if (Number.isFinite(p.startIndex) && p.startIndex >= 1) {
      const carryOffset = carrySumUntil(metaMap, p.startIndex - 1);
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
      const carryOffset = carrySumUntil(metaMap, c.startIndex - 1);
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

export function buildBaseDatesISOFromMetaMap(
  student: Student,
  extra = 60,
  metaMap: Record<number, SessionMeta> = {}
): string[] {
  const pc = Math.max(0, safeInt(student.planCount ?? 0, 0));
  const need = pc + Math.max(0, extra);
  return buildBaseDatesISOFromRulesPure(student, need, metaMap);
}

// -------------------- computeEffectiveISO (pure) --------------------

function getBaseISOWithExtrapolation(baseDatesISO: string[], baseIdx: number): string | null {
  if (baseIdx < 0) return null;
  if (baseIdx < baseDatesISO.length) return baseDatesISO[baseIdx] ?? null;

  if (baseDatesISO.length === 0) return null;

  const lastISO = baseDatesISO[baseDatesISO.length - 1];
  const lastDT = new Date(lastISO);
  if (!Number.isFinite(lastDT.getTime())) return null;

  let stepMs = 7 * 24 * 60 * 60 * 1000;

  if (baseDatesISO.length >= 2) {
    const prevISO = baseDatesISO[baseDatesISO.length - 2];
    const prevDT = new Date(prevISO);
    if (Number.isFinite(prevDT.getTime())) {
      const diff = lastDT.getTime() - prevDT.getTime();
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

// -------------------- badges & active rules (pure) --------------------

export function buildBadges(meta: SessionMeta): string[] {
  const out: string[] = [];

  const carry = safeInt(meta.carry ?? 0, 0);
  if (carry > 0) out.push(`이월+${carry}`);
  if (meta.overrideDate && meta.overrideSource === "manual") {
    out.push("변경");
  }

  return out;
}

export function resolveActiveScheduleRulesCore(args: {
  student?: Student | null;
  targetYmd: string;
  baseDatesISO?: string[];
  metaMap: Record<number, SessionMeta>;
}): ScheduleRule[] {
  const { student, targetYmd, baseDatesISO, metaMap } = args;
  if (!student) return [];
  const defaultRules = Array.isArray(student.scheduleRules) ? student.scheduleRules : [];
  const changes = Array.isArray(student.scheduleChangeEvents) ? student.scheduleChangeEvents : [];
  if (changes.length === 0) return defaultRules;

  const today = targetYmd.trim();
  const sorted = [...changes].sort((a, b) => a.startIndex - b.startIndex);

  let activeRules: ScheduleRule[] = [...defaultRules];

  const computedBaseDates =
    baseDatesISO ??
    buildBaseDatesISOFromMetaMap(student, Math.max(60, (student.planCount ?? 20) + 10), metaMap);

  for (const ch of sorted) {
    if (!Array.isArray(ch.newRules) || ch.newRules.length === 0) continue;

    if (ch.startIndex <= 1) {
      if (ch.startDate && ch.startDate > today) {
        continue;
      }
      activeRules = [...ch.newRules];
    } else {
      const prevIndex = ch.startIndex - 1;
      let prevYmd: string | null = null;

      try {
        const { effectiveISO } = computeEffectiveISO({
          token: student.token,
          index: prevIndex,
          baseDatesISO: computedBaseDates,
          metaMap,
        });
        prevYmd = ymdFromISO_KST(effectiveISO ?? "");
      } catch {
        prevYmd = null;
      }

      if (prevYmd) {
        if (today > prevYmd) {
          activeRules = [...ch.newRules];
        }
      } else {
        if (!ch.startDate || today >= ch.startDate) {
          activeRules = [...ch.newRules];
        }
      }
    }
  }

  return activeRules.length > 0 ? activeRules : defaultRules;
}
