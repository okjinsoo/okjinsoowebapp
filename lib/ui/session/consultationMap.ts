// lib/ui/session/consultationMap.ts
"use client";

import type { ConsultationRecord, Session } from "@/lib/types/index";
import { computeEffectiveISO, type SessionMeta } from "@/lib/factories/sessionFactories";
import { normalizeConsultPurpose } from "@/lib/factories/consultationFactory";

type SessionMetaMap = Record<number, SessionMeta>;

function kstYmdFromISO(iso: string): string | null {
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

function toKstDateMs(ymd: string): number | null {
  if (!ymd) return null;
  const dt = new Date(`${ymd}T00:00:00+09:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.getTime();
}

export type ConsultTag = {
  purpose: "general" | "pause_request" | "extension";
  target: "student" | "parent";
  label: string; // "상담" | "휴회 요청" ...
  badgeClassName: string;
  buttonClassName: string;
  recordId: string;
  finalResult?: "pause_cancel" | "pause_confirm";
  createdAt?: string;
};

export function pickPrimaryConsultTag(tags: ConsultTag[] | undefined | null): ConsultTag | null {
  if (!tags || tags.length === 0) return null;
  const pause = tags.find((t) => t.purpose === "pause_request");
  if (pause) return pause;

  const extension = tags.filter((t) => t.purpose === "extension");
  if (extension.length > 0) {
    extension.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
    return extension[extension.length - 1];
  }
  return tags[0];
}

export function buildConsultationMap(params: {
  token: string;
  sessions: Session[];
  baseDatesISO: string[];
  metaMap: SessionMetaMap;
  records: ConsultationRecord[];
}): Record<number, ConsultTag[]> {
  const { token, sessions, baseDatesISO, metaMap, records } = params;
  if (!records.length || !sessions.length) return {};

  const sessionDates = sessions.map((s) => {
    const { effectiveISO } = computeEffectiveISO({
      token,
      index: s.index,
      baseDatesISO,
      metaMap,
    });
    const iso = effectiveISO ?? "";
    const ymd = iso ? kstYmdFromISO(iso) : null;
    const timeMs = iso ? new Date(iso).getTime() : null;
    return { index: s.index, iso, ymd, timeMs };
  });

  const map: Record<number, ConsultTag[]> = {};

  for (const rec of records) {
    const recYmd = rec.date;
    const recMs = toKstDateMs(recYmd);
    let targetIndex: number | null = null;

    if (recYmd) {
      const sameDay = sessionDates.filter((s) => s.ymd === recYmd);
      if (sameDay.length > 0) {
        sameDay.sort((a, b) => a.index - b.index);
        targetIndex = sameDay[0].index;
      }
    }

    if (targetIndex === null && recMs !== null) {
      const future = sessionDates.filter((s) => s.timeMs !== null && (s.timeMs as number) >= recMs);
      if (future.length > 0) {
        future.sort((a, b) => (a.timeMs as number) - (b.timeMs as number));
        targetIndex = future[0].index;
      }
    }

    const purpose = normalizeConsultPurpose((rec as { purpose?: unknown }).purpose);

    if (targetIndex === null && recMs !== null && (purpose === "extension" || purpose === "pause_request")) {
      const past = sessionDates.filter((s) => s.timeMs !== null && (s.timeMs as number) < recMs);
      if (past.length > 0) {
        past.sort((a, b) => (b.timeMs as number) - (a.timeMs as number));
        targetIndex = past[0].index;
      }
    }

    if (targetIndex === null) continue;

    const target = rec.target === "parent" ? "parent" : "student";
    const result =
      purpose === "pause_request"
        ? rec.finalResult === "pause_cancel"
          ? "휴회 취소"
          : rec.finalResult === "pause_confirm"
            ? "휴회 예정"
            : "휴회 요청"
        : purpose === "extension"
          ? rec.extensionResult === "extended"
            ? rec.extensionPaymentConfirmed
              ? "연장"
              : "연장 요청"
            : rec.extensionResult === "not_extended"
              ? "미연장"
              : "연장 요청"
        : "일반 상담";
    const targetLabel = "";

    const tag: ConsultTag = {
      purpose,
      target,
      label: targetLabel ? `${result} · ${targetLabel}` : result,
      badgeClassName:
        result === "휴회 예정" || result === "미연장"
          ? "bg-red-500 text-white"
          : result === "연장 요청" || result === "연장"
            ? "bg-blue-600 text-white"
            : purpose === "pause_request"
              ? "bg-orange-200 text-orange-900"
              : "bg-slate-200 text-slate-700",
      buttonClassName:
        result === "휴회 예정" || result === "미연장"
          ? "btn btn-red"
          : result === "연장 요청" || result === "연장"
            ? "btn btn-blue"
          : purpose === "pause_request"
            ? "btn btn-orange"
            : "btn btn-white",
      recordId: rec.id,
      finalResult: rec.finalResult,
      createdAt: rec.createdAt,
    };

    map[targetIndex] = map[targetIndex] ? [...map[targetIndex], tag] : [tag];
  }

  return map;
}
