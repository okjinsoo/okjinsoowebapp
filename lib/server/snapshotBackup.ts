import "server-only";

type BackupConfig = {
  url: string;
  serviceRoleKey: string;
};

type SnapshotRow = {
  id?: string;
  teachers?: unknown;
  students?: unknown;
  sessions?: unknown;
  state_kv?: unknown;
};

type NormalizedSnapshot = {
  id: string;
  teachers: unknown[];
  students: unknown[];
  sessions: unknown[];
  stateKv: Record<string, unknown>;
};

export type DailyBackupResult = {
  ok: boolean;
  backupDate: string;
  inserted: boolean;
  backupId: string;
  message: string;
};

function getBackupConfig(): BackupConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function buildHeaders(config: BackupConfig, json = false): Record<string, string> {
  const out: Record<string, string> = {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
  if (json) out["Content-Type"] = "application/json";
  return out;
}

function isMissingColumnError(detail: string, column: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes(column.toLowerCase()) &&
    (lower.includes("column") || lower.includes("schema cache") || lower.includes("42703"))
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function fetchMainSnapshot(config: BackupConfig): Promise<NormalizedSnapshot> {
  const baseUrl = new URL("/rest/v1/app_state_snapshots", config.url);
  const selectFields = ["id", "teachers", "students", "sessions", "state_kv"];

  while (selectFields.length >= 3) {
    const url = new URL(baseUrl.toString());
    url.searchParams.set("select", selectFields.join(","));
    url.searchParams.set("id", "eq.main");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: buildHeaders(config),
      cache: "no-store",
    });

    if (res.ok) {
      const rows = (await res.json()) as SnapshotRow[];
      const row = rows[0] ?? {};
      return {
        id: typeof row.id === "string" && row.id.trim() ? row.id : "main",
        teachers: asArray(row.teachers),
        students: asArray(row.students),
        sessions: asArray(row.sessions),
        stateKv: asObject(row.state_kv),
      };
    }

    const text = await res.text();
    let changed = false;
    if (selectFields.includes("sessions") && isMissingColumnError(text, "sessions")) {
      selectFields.splice(selectFields.indexOf("sessions"), 1);
      changed = true;
    }
    if (selectFields.includes("state_kv") && isMissingColumnError(text, "state_kv")) {
      selectFields.splice(selectFields.indexOf("state_kv"), 1);
      changed = true;
    }
    if (changed) continue;

    throw new Error(`snapshot read failed: ${res.status} ${text}`);
  }

  return {
    id: "main",
    teachers: [],
    students: [],
    sessions: [],
    stateKv: {},
  };
}

function todayDateUtc(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function upsertDailyBackup(args: {
  config: BackupConfig;
  snapshot: NormalizedSnapshot;
  backupDate: string;
  source: string;
}): Promise<void> {
  const url = new URL("/rest/v1/app_state_snapshot_backups", args.config.url);
  url.searchParams.set("on_conflict", "snapshot_id,backup_date");

  const backupId = `${args.snapshot.id}-${args.backupDate}`;
  const payload = [
    {
      id: backupId,
      snapshot_id: args.snapshot.id,
      backup_date: args.backupDate,
      source: args.source,
      teachers: args.snapshot.teachers,
      students: args.snapshot.students,
      sessions: args.snapshot.sessions,
      state_kv: args.snapshot.stateKv,
    },
  ];

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      ...buildHeaders(args.config, true),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`backup upsert failed: ${res.status} ${text}`);
  }
}

export async function runDailySnapshotBackup(source = "daily_cron"): Promise<DailyBackupResult> {
  const config = getBackupConfig();
  const backupDate = todayDateUtc();
  const backupId = `main-${backupDate}`;

  if (!config) {
    return {
      ok: false,
      backupDate,
      inserted: false,
      backupId,
      message: "환경변수 누락: NEXT_PUBLIC_SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  try {
    const snapshot = await fetchMainSnapshot(config);
    await upsertDailyBackup({
      config,
      snapshot,
      backupDate,
      source,
    });
    return {
      ok: true,
      backupDate,
      inserted: true,
      backupId,
      message: "일일 백업 저장 완료",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "daily_backup_failed";
    return {
      ok: false,
      backupDate,
      inserted: false,
      backupId,
      message,
    };
  }
}

