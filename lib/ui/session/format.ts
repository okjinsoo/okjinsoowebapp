// v1/lib/ui/session/format.ts
// Shared date/D-day formatting helpers used by multiple session UI cores.

export function dayDiffLocal(from: Date, to: Date) {
  const a = new Date(from);
  a.setHours(0, 0, 0, 0);
  const b = new Date(to);
  b.setHours(0, 0, 0, 0);
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

export function ddayClass(d: number) {
  if (d === 0) return "bg-emerald-600";
  if (d === 1) return "bg-red-600";
  if (d > 1) return "bg-orange-600";
  return "bg-slate-600";
}

export function fmtKST_yyyyMMdd_HHmm_noSeconds(iso: string) {
  try {
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);

    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    return `${y}. ${m}. ${d}. ${hh}시 ${mm}분`;
  } catch {
    return "";
  }
}

function formatTimeLabelKST(hour: string, minute: string): string {
  return `${hour}:${minute}`;
}

export function fmtKST_yyyyMMdd_TimeRange(iso: string, durationMin?: number) {
  try {
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) return "";

    const startParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(dt);
    const y = startParts.find((p) => p.type === "year")?.value ?? "1970";
    const m = startParts.find((p) => p.type === "month")?.value ?? "01";
    const d = startParts.find((p) => p.type === "day")?.value ?? "01";
    const hh = startParts.find((p) => p.type === "hour")?.value ?? "00";
    const mm = startParts.find((p) => p.type === "minute")?.value ?? "00";
    const dateText = `${y}. ${m}. ${d}.`;
    const normalizedDuration = Math.max(0, Math.floor(Number(durationMin)));
    if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
      return `${dateText} ${formatTimeLabelKST(hh, mm)}`;
    }

    const end = new Date(dt.getTime() + normalizedDuration * 60 * 1000);
    const endParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(end);
    const ehh = endParts.find((p) => p.type === "hour")?.value ?? "00";
    const emm = endParts.find((p) => p.type === "minute")?.value ?? "00";
    return `${dateText} ${formatTimeLabelKST(hh, mm)} ~ ${formatTimeLabelKST(ehh, emm)}`;
  } catch {
    return "";
  }
}
export function parseDateTime(iso: string | null | undefined, durationMin?: number) {
  if (!iso) return { dateText: "날짜 없음", timeText: "-" };
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return { dateText: "날짜 없음", timeText: "-" };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  const normalizedDuration = Math.max(0, Math.floor(Number(durationMin)));
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    return { dateText: `${y}. ${m}. ${d}.`, timeText: formatTimeLabelKST(hh, mm) };
  }
  const end = new Date(dt.getTime() + normalizedDuration * 60 * 1000);
  const endParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(end);
  const ehh = endParts.find((p) => p.type === "hour")?.value ?? "00";
  const emm = endParts.find((p) => p.type === "minute")?.value ?? "00";
  return {
    dateText: `${y}. ${m}. ${d}.`,
    timeText: `${formatTimeLabelKST(hh, mm)} ~ ${formatTimeLabelKST(ehh, emm)}`,
  };
}
