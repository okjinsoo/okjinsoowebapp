#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const options = {
  sourceEnv: ".env.local",
  targetEnv: ".env.local.sandbox",
  snapshotId: "main",
  dryRun: false,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--source-env") {
    const value = args[i + 1];
    if (!value) fail("--source-env 뒤에 경로를 넣어주세요.");
    options.sourceEnv = value;
    i += 1;
    continue;
  }
  if (arg === "--target-env") {
    const value = args[i + 1];
    if (!value) fail("--target-env 뒤에 경로를 넣어주세요.");
    options.targetEnv = value;
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
  if (arg === "--dry-run") {
    options.dryRun = true;
    continue;
  }
  fail(`알 수 없는 옵션: ${arg}`);
}

const sourcePath = path.resolve(process.cwd(), options.sourceEnv);
const targetPath = path.resolve(process.cwd(), options.targetEnv);

if (!fs.existsSync(sourcePath)) fail(`소스 env 파일이 없습니다: ${sourcePath}`);
if (!fs.existsSync(targetPath)) fail(`타겟 env 파일이 없습니다: ${targetPath}`);

const sourceEnv = parseEnvFile(fs.readFileSync(sourcePath, "utf8"));
const targetEnv = parseEnvFile(fs.readFileSync(targetPath, "utf8"));

const sourceCfg = resolveConfig(sourceEnv, "source");
const targetCfg = resolveConfig(targetEnv, "target");

if (normalizeUrl(sourceCfg.url) === normalizeUrl(targetCfg.url)) {
  fail("안전 중단: source/target Supabase URL이 같습니다. 다른 프로젝트를 지정해주세요.");
}

const sourceRow = await fetchSnapshotRow({
  cfg: sourceCfg,
  snapshotId: options.snapshotId,
  label: "source",
});
if (!sourceRow) {
  fail(`source에서 snapshot(${options.snapshotId})을 찾지 못했습니다.`);
}

const targetBefore = await fetchSnapshotRow({
  cfg: targetCfg,
  snapshotId: options.snapshotId,
  label: "target",
});

printSummary("source", sourceRow);
if (targetBefore) {
  printSummary("target-before", targetBefore);
} else {
  console.log("[target-before] snapshot 없음");
}

if (options.dryRun) {
  console.log("[dry-run] 실제 쓰기는 하지 않았습니다.");
  process.exit(0);
}

const payload = {
  id: options.snapshotId,
  teachers: Array.isArray(sourceRow.teachers) ? sourceRow.teachers : [],
  students: Array.isArray(sourceRow.students) ? sourceRow.students : [],
  sessions: Array.isArray(sourceRow.sessions) ? sourceRow.sessions : [],
  state_kv: normalizeStateKv(sourceRow.state_kv),
};

await upsertSnapshot({
  cfg: targetCfg,
  payload,
  label: "target",
});

const targetAfter = await fetchSnapshotRow({
  cfg: targetCfg,
  snapshotId: options.snapshotId,
  label: "target",
});

if (!targetAfter) {
  fail("쓰기 후 target snapshot 조회에 실패했습니다.");
}

printSummary("target-after", targetAfter);
console.log("완료: source snapshot을 target으로 동기화했습니다.");

function parseEnvFile(rawText) {
  const env = {};
  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const delimiterIndex = line.indexOf("=");
    if (delimiterIndex === -1) continue;
    const key = line.slice(0, delimiterIndex).trim();
    if (!key) continue;
    let value = line.slice(delimiterIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function resolveConfig(env, label) {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url) fail(`${label}: NEXT_PUBLIC_SUPABASE_URL 값이 없습니다.`);
  if (!serviceRoleKey) fail(`${label}: SUPABASE_SERVICE_ROLE_KEY 값이 없습니다.`);
  if (/your_|YOUR_/.test(url) || /your_|YOUR_/.test(serviceRoleKey)) {
    fail(`${label}: placeholder 값이 남아 있습니다. 실제 Supabase 값으로 교체해주세요.`);
  }
  return { url, serviceRoleKey };
}

function normalizeUrl(raw) {
  return String(raw || "").trim().replace(/\/+$/, "");
}

function normalizeStateKv(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!k) continue;
    if (typeof v === "string") {
      out[k] = v;
      continue;
    }
    if (v === null || v === undefined) continue;
    out[k] = JSON.stringify(v);
  }
  return out;
}

async function fetchSnapshotRow({ cfg, snapshotId, label }) {
  const fields = ["id", "teachers", "students", "sessions", "state_kv"];
  while (fields.length >= 1) {
    const url = new URL("/rest/v1/app_state_snapshots", cfg.url);
    url.searchParams.set("select", fields.join(","));
    url.searchParams.set("id", `eq.${snapshotId}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        apikey: cfg.serviceRoleKey,
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
      },
      cache: "no-store",
    });

    if (res.ok) {
      const rows = await res.json();
      return rows[0] ?? null;
    }

    const text = await res.text();
    const lowered = text.toLowerCase();
    let changed = false;

    if (fields.includes("sessions") && isMissingColumn(lowered, "sessions")) {
      fields.splice(fields.indexOf("sessions"), 1);
      changed = true;
    }
    if (fields.includes("state_kv") && isMissingColumn(lowered, "state_kv")) {
      fields.splice(fields.indexOf("state_kv"), 1);
      changed = true;
    }

    if (changed) continue;
    fail(`${label} snapshot 조회 실패: ${res.status} ${text}`);
  }
  return null;
}

function isMissingColumn(loweredText, columnName) {
  return (
    loweredText.includes(columnName.toLowerCase()) &&
    (loweredText.includes("schema cache") || loweredText.includes("42703") || loweredText.includes("column"))
  );
}

async function upsertSnapshot({ cfg, payload, label }) {
  const url = new URL("/rest/v1/app_state_snapshots", cfg.url);
  url.searchParams.set("on_conflict", "id");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([payload]),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    fail(`${label} snapshot upsert 실패: ${res.status} ${text}`);
  }
}

function printSummary(label, row) {
  const teachers = Array.isArray(row?.teachers) ? row.teachers.length : 0;
  const students = Array.isArray(row?.students) ? row.students.length : 0;
  const sessions = Array.isArray(row?.sessions) ? row.sessions.length : 0;
  const kv = row?.state_kv && typeof row.state_kv === "object" && !Array.isArray(row.state_kv)
    ? Object.keys(row.state_kv).length
    : 0;
  console.log(`[${label}] teachers=${teachers} students=${students} sessions=${sessions} state_kv_keys=${kv}`);
}

function fail(message) {
  console.error(`[snapshot-sync] ${message}`);
  process.exit(1);
}
