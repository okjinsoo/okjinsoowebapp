export function todayYmdLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatYmdKST(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export function todayYmdKST(): string {
  return formatYmdKST(new Date());
}

export function ymdFromISO_KST(iso?: string | null): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return null;
  return formatYmdKST(dt);
}

export function kstDateMs(ymd: string): number | null {
  if (!ymd) return null;
  const dt = new Date(`${ymd}T00:00:00+09:00`);
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.getTime();
}

export function nowIso(): string {
  return new Date().toISOString();
}
