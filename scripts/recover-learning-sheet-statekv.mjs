#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const options = {
  env: ".env.local",
  snapshotId: "main",
  backupDate: "",
  dryRun: false,
  overwrite: false,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--env") {
    const value = args[i + 1];
    if (!value) fail("--env 뒤에 경로를 넣어주세요.");
    options.env = value;
    i += 1;
    continue;
  }
  if (arg === "--snapshot-id") {
    const value = args[i + 1];
    if (!value) fail("--snapshot-id 뒤에 값을 넣어주세요.");
    options.snapshotId = value;
    i += 1;
    continue;
  }
  if (arg === "--backup-date") {
    const value = args[i + 1];
    if (!value) fail("--backup-date 뒤에 YYYY-MM-DD를 넣어주세요.");
    options.backupDate = value;
    i += 1;
    continue;
  }
  if (arg === "--dry-run") {
    options.dryRun = true;
    continue;
  }
  if (arg === "--overwrite") {
    options.overwrite = true;
    continue;
  }
  fail(`알 수 없는 옵션: ${arg}`);
}

if (!options.backupDate) {
  fail("--backup-date는 필수입니다. 예: --backup-date 2026-05-12");
}

const envPath = path.resolve(process.cwd(), options.env);
if (!fs.existsSync(envPath)) fail(`env 파일이 없습니다: ${envPath}`);

const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
const cfg = resolveConfig(env);

const currentSnapshot = await fetchSnapshotRow({
  cfg,
  snapshotId: options.snapshotId,
});
if (!currentSnapshot) {
  fail(`현재 snapshot(${options.snapshotId})을 찾지 못했습니다.`);
}

const backupSnapshot = await fetchBackupRow({
  cfg,
  snapshotId: options.snapshotId,
  backupDate: options.backupDate,
});
if (!backupSnapshot) {
  fail(`백업(${options.snapshotId}, ${options.backupDate})을 찾지 못했습니다.`);
}

const currentStateKv = asObject(currentSnapshot.state_kv);
const backupStateKv = asObject(backupSnapshot.state_kv);
const students = Array.isArray(currentSnapshot.students) ? currentSnapshot.students : [];
const sessions = Array.isArray(currentSnapshot.sessions) ? currentSnapshot.sessions : [];

const studentTokens = new Set(
  students.map((row) => normalizeString(row?.token)).filter((token) => token.length > 0)
);

const candidateKeys = Object.keys(backupStateKv).filter((key) => {
  const m = key.match(/^mk3:([^:]+):session:(\d+):(leafIds|progressByLeafId|lastAddedLeafId|items)$/);
  if (!m) return false;
  return studentTokens.has(m[1]);
});

const toRestore = candidateKeys.filter((key) => {
  if (!Object.prototype.hasOwnProperty.call(currentStateKv, key)) return true;
  return options.overwrite;
});

const mergedStateKv = { ...currentStateKv };
for (const key of toRestore) {
  const raw = backupStateKv[key];
  if (typeof raw === "string") {
    mergedStateKv[key] = raw;
    continue;
  }
  if (raw !== null && raw !== undefined) {
    mergedStateKv[key] = JSON.stringify(raw);
  }
}

const beforeRows = computeLearningRows({ students, sessions, stateKv: currentStateKv });
const afterRows = computeLearningRows({ students, sessions, stateKv: mergedStateKv });
const preview = beforeRows.map((row, idx) => {
  const next = afterRows[idx] ?? { rowCount: 0, sessionWithRows: 0 };
  return {
    name: row.name,
    nowRows: row.rowCount,
    afterRows: next.rowCount,
    deltaRows: next.rowCount - row.rowCount,
    nowSessions: row.sessionWithRows,
    afterSessions: next.sessionWithRows,
  };
});

printSummary({
  backupDate: options.backupDate,
  currentKeys: Object.keys(currentStateKv).length,
  backupKeys: Object.keys(backupStateKv).length,
  candidateKeys: candidateKeys.length,
  restoreKeys: toRestore.length,
  overwrite: options.overwrite,
  dryRun: options.dryRun,
  preview,
});

if (options.dryRun) {
  console.log("[dry-run] 실제 쓰기는 하지 않았습니다.");
  process.exit(0);
}

if (toRestore.length === 0) {
  console.log("복구할 키가 없어 쓰기를 생략했습니다.");
  process.exit(0);
}

await upsertStateKv({
  cfg,
  snapshotId: options.snapshotId,
  stateKv: mergedStateKv,
});

console.log(`복구 완료: ${toRestore.length}개 키를 ${options.snapshotId}에 반영했습니다.`);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeJsonParse(raw, fallback) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function computeLearningRows(args) {
  const rows = [];
  const studentRows = Array.isArray(args.students) ? args.students : [];
  const sessionRows = Array.isArray(args.sessions) ? args.sessions : [];
  const stateKv = args.stateKv && typeof args.stateKv === "object" ? args.stateKv : {};

  for (const student of studentRows) {
    const token = normalizeString(student?.token);
    const studentId = normalizeString(student?.id);
    const studentName = normalizeString(student?.name) || "이름없음";
    if (!token || !studentId) continue;

    const targetSessions = sessionRows.filter((session) => normalizeString(session?.studentId) === studentId);
    let rowCount = 0;
    let sessionWithRows = 0;

    for (const session of targetSessions) {
      const idx = Number(session?.index);
      if (!Number.isFinite(idx) || idx < 1) continue;

      const key = `mk3:${token}:session:${idx}:leafIds`;
      const parsed = safeJsonParse(stateKv[key], []);
      const leafIds = Array.isArray(parsed)
        ? parsed.filter((item) => typeof item === "string" && item.trim().length > 0)
        : [];

      if (leafIds.length > 0) sessionWithRows += 1;

      for (const leafId of leafIds) {
        if (/^(notice_|wrongnote_|custom_)/.test(leafId)) rowCount += 1;
        else rowCount += 2;
      }
    }

    rows.push({
      name: studentName,
      rowCount,
      sessionWithRows,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return rows;
}

function parseEnvFile(rawText) {
  const out = {};
  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveConfig(env) {
  const url = normalizeString(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = normalizeString(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url) fail("NEXT_PUBLIC_SUPABASE_URL 값이 없습니다.");
  if (!serviceRoleKey) fail("SUPABASE_SERVICE_ROLE_KEY 값이 없습니다.");
  return { url, serviceRoleKey };
}

function asObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key) continue;
    if (typeof raw === "string") {
      out[key] = raw;
      continue;
    }
    if (raw === null || raw === undefined) continue;
    try {
      out[key] = JSON.stringify(raw);
    } catch {
      // noop
    }
  }
  return out;
}

async function fetchSnapshotRow(args) {
  const url = new URL("/rest/v1/app_state_snapshots", args.cfg.url);
  url.searchParams.set("select", "id,students,sessions,state_kv");
  url.searchParams.set("id", `eq.${args.snapshotId}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: args.cfg.serviceRoleKey,
      Authorization: `Bearer ${args.cfg.serviceRoleKey}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    fail(`현재 snapshot 조회 실패: ${res.status} ${text}`);
  }

  const rows = await res.json();
  return rows[0] ?? null;
}

async function fetchBackupRow(args) {
  const url = new URL("/rest/v1/app_state_snapshot_backups", args.cfg.url);
  url.searchParams.set("select", "id,snapshot_id,backup_date,state_kv");
  url.searchParams.set("snapshot_id", `eq.${args.snapshotId}`);
  url.searchParams.set("backup_date", `eq.${args.backupDate}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: args.cfg.serviceRoleKey,
      Authorization: `Bearer ${args.cfg.serviceRoleKey}`,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    fail(`백업 조회 실패: ${res.status} ${text}`);
  }

  const rows = await res.json();
  return rows[0] ?? null;
}

async function upsertStateKv(args) {
  const url = new URL("/rest/v1/app_state_snapshots", args.cfg.url);
  url.searchParams.set("on_conflict", "id");

  const payload = [
    {
      id: args.snapshotId,
      state_kv: args.stateKv,
    },
  ];

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: args.cfg.serviceRoleKey,
      Authorization: `Bearer ${args.cfg.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    fail(`state_kv upsert 실패: ${res.status} ${text}`);
  }
}

function printSummary(args) {
  console.log("[learning-statekv-recovery]");
  console.log(`- backupDate: ${args.backupDate}`);
  console.log(`- current state_kv keys: ${args.currentKeys}`);
  console.log(`- backup state_kv keys: ${args.backupKeys}`);
  console.log(`- candidate session keys: ${args.candidateKeys}`);
  console.log(`- keys to restore: ${args.restoreKeys}`);
  console.log(`- overwrite existing: ${args.overwrite ? "yes" : "no"}`);
  console.log(`- dry-run: ${args.dryRun ? "yes" : "no"}`);

  const meaningful = args.preview.filter((row) => row.deltaRows !== 0);
  if (meaningful.length === 0) {
    console.log("- row preview: 변화 없음");
    return;
  }

  console.log("- row preview:");
  for (const row of meaningful) {
    console.log(
      `  * ${row.name}: ${row.nowRows} -> ${row.afterRows} (delta ${row.deltaRows}), 세션 ${row.nowSessions} -> ${row.afterSessions}`
    );
  }
}

function fail(message) {
  console.error(`[learning-statekv-recovery] ${message}`);
  process.exit(1);
}
