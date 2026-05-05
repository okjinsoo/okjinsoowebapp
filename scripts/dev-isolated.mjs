#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
let envFile = ".env.local.sandbox";
const forwardedArgs = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--env-file") {
    const customPath = args[i + 1];
    if (!customPath) {
      console.error("[isolated-dev] --env-file 다음에 파일 경로를 넣어주세요.");
      process.exit(1);
    }
    envFile = customPath;
    i += 1;
    continue;
  }
  forwardedArgs.push(arg);
}

const resolvedEnvPath = path.resolve(process.cwd(), envFile);
if (!fs.existsSync(resolvedEnvPath)) {
  console.error(
    `[isolated-dev] ${envFile} 파일이 없습니다.\n` +
      "  1) cp env.sandbox.example .env.local.sandbox\n" +
      "  2) 운영과 다른 Supabase 프로젝트 키로 채우기\n" +
      "  3) npm run dev:isolated"
  );
  process.exit(1);
}

const loadedEnv = parseEnvFile(fs.readFileSync(resolvedEnvPath, "utf8"));
for (const [key, value] of Object.entries(loadedEnv)) {
  process.env[key] = value;
}

const defaultEnvPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(defaultEnvPath)) {
  const defaultEnv = parseEnvFile(fs.readFileSync(defaultEnvPath, "utf8"));
  const sandboxUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const defaultUrl = (defaultEnv.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (sandboxUrl && defaultUrl && sandboxUrl === defaultUrl) {
    console.error(
      `[isolated-dev] 안전 중단: ${path.basename(
        resolvedEnvPath
      )}의 Supabase URL이 .env.local과 같습니다.\n` +
        "  운영 영향 방지를 위해 테스트 전용 Supabase 프로젝트 URL을 사용해주세요."
    );
    process.exit(1);
  }
}

const requiredKeys = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_BRIDGE_COOKIE_SECRET",
];
const missingKeys = requiredKeys.filter((key) => !process.env[key]);
if (missingKeys.length > 0) {
  console.error(
    `[isolated-dev] 필수 환경변수가 비어 있습니다: ${missingKeys.join(", ")}`
  );
  process.exit(1);
}

process.env.TUTORWEB_ISOLATED = process.env.TUTORWEB_ISOLATED || "1";
process.env.NEXT_PUBLIC_TUTORWEB_ISOLATED =
  process.env.NEXT_PUBLIC_TUTORWEB_ISOLATED || process.env.TUTORWEB_ISOLATED;
process.env.TUTORWEB_LOCAL_ONLY = process.env.TUTORWEB_LOCAL_ONLY || "1";
process.env.NEXT_PUBLIC_TUTORWEB_LOCAL_ONLY =
  process.env.NEXT_PUBLIC_TUTORWEB_LOCAL_ONLY || process.env.TUTORWEB_LOCAL_ONLY;
process.env.PORT = process.env.PORT || "4100";

console.log(
  `[isolated-dev] env=${path.basename(
    resolvedEnvPath
  )} port=${process.env.PORT} mode=isolated`
);

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const nextArgs = ["next", "dev", "-p", process.env.PORT, ...forwardedArgs];
const child = spawn(command, nextArgs, {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function parseEnvFile(rawText) {
  const env = {};
  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const delimiterIndex = line.indexOf("=");
    if (delimiterIndex === -1) {
      continue;
    }
    const key = line.slice(0, delimiterIndex).trim();
    if (!key) {
      continue;
    }
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
