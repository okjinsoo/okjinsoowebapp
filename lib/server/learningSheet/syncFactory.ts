import "server-only";

import { getSupabaseAdminConfig } from "@/lib/server/supabaseAdmin";
import type { Session, Student, Teacher } from "@/lib/types/index";
import {
  sessionLeafIdsKey,
  sessionProgressByLeafIdKey,
} from "@/lib/storage/sharedStateKeys";
import {
  assertOwnerOAuthReady,
  createSpreadsheet,
  ensureWriterPermission,
  getOwnerEmail,
  getParentFolderId,
  getSpreadsheetSheets,
  moveFileToFolder,
  sheetsBatchUpdate,
  sheetsValuesClear,
  sheetsValuesUpdate,
} from "@/lib/server/learningSheet/googleOwnerClient";

const SNAPSHOT_ID = "main";
const TEACHER_SHEET_MAP_PREFIX = "tutorweb_learning_sheet_teacher_v1:";
const HEADER_ROW = ["기간", "회차", "학습", "제출여부", "내용", "링크"];

export type LearningSheetSyncResult = {
  teacherId: string;
  teacherName: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  syncedStudentCount: number;
  skippedStudentCount: number;
  rowsWritten: number;
};

type TeacherSheetMap = {
  teacherId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
};

type SnapshotStateKvRaw = Record<string, unknown>;

type LeafMeta = {
  title: string;
  lectureUrl: string;
  problemUrl: string;
};

type LeafProgress = {
  noteDone?: boolean;
  solveDone?: boolean;
  noteLink?: string;
  solveLink?: string;
  wrongNoteDone?: boolean;
  wrongNoteLink?: string;
  customTitle?: string;
  customProblemUrl?: string;
  noticeContent?: string;
};

type SessionScopedRow = {
  period: string;
  sessionIndex: number;
  category: "강의" | "문제" | "오답노트" | "공지";
  content: string;
  submit: "T" | "F" | "";
  link: string;
};

function teacherMapKey(teacherId: string): string {
  return `${TEACHER_SHEET_MAP_PREFIX}${teacherId}`;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseTeacherSheetMap(raw: string | null): TeacherSheetMap | null {
  const row = safeJsonParse<Partial<TeacherSheetMap> | null>(raw, null);
  if (!row) return null;
  const teacherId = (row.teacherId ?? "").trim();
  const spreadsheetId = (row.spreadsheetId ?? "").trim();
  const spreadsheetUrl = (row.spreadsheetUrl ?? "").trim();
  if (!teacherId || !spreadsheetId || !spreadsheetUrl) return null;
  return {
    teacherId,
    spreadsheetId,
    spreadsheetUrl,
    title: (row.title ?? "").trim(),
    ownerEmail: (row.ownerEmail ?? "").trim(),
    createdAt: (row.createdAt ?? "").trim() || new Date().toISOString(),
    updatedAt: (row.updatedAt ?? "").trim() || new Date().toISOString(),
  };
}

function parseTeacherSheetMapValue(raw: unknown): TeacherSheetMap | null {
  if (typeof raw === "string") {
    return parseTeacherSheetMap(raw);
  }
  if (!raw || typeof raw !== "object") {
    return null;
  }
  try {
    return parseTeacherSheetMap(JSON.stringify(raw));
  } catch {
    return null;
  }
}

function normalizeTabName(raw: string): string {
  const trimmed = raw.trim();
  const replaced = trimmed.replace(/[\\\/?*\[\]:]/g, "_").replace(/\s+/g, " ");
  const fallback = replaced || "학생";
  const limited = fallback.slice(0, 90).trim();
  return limited || "학생";
}

function composeStudentTabName(student: Student): string {
  const base = `${student.cohort ?? "기수없음"}_${student.name ?? "이름없음"}`;
  return normalizeTabName(base);
}

function ensureUniqueSheetTitle(desired: string, used: Set<string>): string {
  let title = desired;
  let n = 1;
  while (used.has(title)) {
    n += 1;
    const suffix = `(${n})`;
    const limit = Math.max(1, 100 - suffix.length);
    title = `${desired.slice(0, limit)}${suffix}`;
  }
  used.add(title);
  return title;
}

function parseLectureLeafMap(rawTree: string | null): Map<string, LeafMeta> {
  const map = new Map<string, LeafMeta>();
  const tree = safeJsonParse<Record<string, unknown> | null>(rawTree, null);
  const root = tree && typeof tree === "object" ? (tree.root as unknown) : null;

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type : "";
    if (type === "leaf") {
      const leafId = typeof rec.leafId === "string" ? rec.leafId.trim() : "";
      if (!leafId) return;
      const title = typeof rec.title === "string" ? rec.title.trim() : "";
      const lectureUrl = typeof rec.lectureUrl === "string" ? rec.lectureUrl.trim() : "";
      let problemUrl = "";
      if (Array.isArray(rec.problemUrls)) {
        const first = rec.problemUrls.find((item) => typeof item === "string" && item.trim()) as
          | string
          | undefined;
        problemUrl = first?.trim() ?? "";
      }
      map.set(leafId, {
        title: title || "제목 없는 강의",
        lectureUrl,
        problemUrl,
      });
      return;
    }

    const children = Array.isArray(rec.children) ? rec.children : [];
    for (const child of children) walk(child);
  };

  walk(root);
  return map;
}

function toKstYmd(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(date)
    .reduce(
      (acc, part) => {
        if (part.type === "year") acc.y = part.value;
        if (part.type === "month") acc.m = part.value;
        if (part.type === "day") acc.d = part.value;
        return acc;
      },
      { y: "1970", m: "01", d: "01" }
    );
  return `${parts.y}-${parts.m}-${parts.d}`;
}

function ymdToKstNoon(ymd: string): Date {
  return new Date(`${ymd}T12:00:00+09:00`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function weekLabelFromDisplayAt(displayAt: string): string {
  const dt = new Date(displayAt);
  if (!Number.isFinite(dt.getTime())) return "기간 미정";

  const ymd = toKstYmd(dt);
  const base = ymdToKstNoon(ymd);
  const day = base.getUTCDay(); // 0: Sun

  const weekStart = addDays(base, -day);
  const weekEnd = addDays(weekStart, 6);
  const weekStartYmd = toKstYmd(weekStart);
  const weekEndYmd = toKstYmd(weekEnd);

  const month = Number(ymd.slice(5, 7));
  const monthStart = ymdToKstNoon(`${ymd.slice(0, 7)}-01`);
  const monthStartDow = monthStart.getUTCDay();
  const firstWeekStart = addDays(monthStart, -monthStartDow);
  const diffDays = Math.floor((weekStart.getTime() - firstWeekStart.getTime()) / (24 * 60 * 60 * 1000));
  const weekOfMonth = Math.floor(diffDays / 7) + 1;

  return `${month}월 ${weekOfMonth}주차 (${weekStartYmd}~${weekEndYmd})`;
}

function parseLeafIdsFromStateKv(args: {
  stateKv: Record<string, string>;
  studentToken: string;
  sessionIndex: number;
  fallbackLeafIds?: string[];
}): string[] {
  const key = sessionLeafIdsKey(args.studentToken, args.sessionIndex);
  const parsed = safeJsonParse<unknown>(args.stateKv[key], []);
  if (Array.isArray(parsed)) {
    return parsed.filter((row): row is string => typeof row === "string" && row.trim().length > 0);
  }
  return Array.isArray(args.fallbackLeafIds) ? args.fallbackLeafIds : [];
}

function parseProgressByLeafIdFromStateKv(args: {
  stateKv: Record<string, string>;
  studentToken: string;
  sessionIndex: number;
}): Record<string, LeafProgress> {
  const key = sessionProgressByLeafIdKey(args.studentToken, args.sessionIndex);
  const parsed = safeJsonParse<Record<string, LeafProgress> | null>(args.stateKv[key], null);
  if (!parsed || typeof parsed !== "object") return {};
  return parsed;
}

function asSubmit(done: boolean): "T" | "F" {
  return done ? "T" : "F";
}

function buildRowsForSession(args: {
  session: Session;
  student: Student;
  stateKv: Record<string, string>;
  leafMetaMap: Map<string, LeafMeta>;
}): SessionScopedRow[] {
  const { session, student, stateKv, leafMetaMap } = args;
  const period = weekLabelFromDisplayAt(session.displayAt ?? "");
  const leafIds = parseLeafIdsFromStateKv({
    stateKv,
    studentToken: student.token,
    sessionIndex: session.index,
    fallbackLeafIds: session.lectureLeafIds,
  });
  const progressByLeafId = parseProgressByLeafIdFromStateKv({
    stateKv,
    studentToken: student.token,
    sessionIndex: session.index,
  });

  const rows: SessionScopedRow[] = [];

  for (const leafId of leafIds) {
    const p = progressByLeafId[leafId] ?? {};

    if (leafId.startsWith("notice_")) {
      rows.push({
        period,
        sessionIndex: session.index,
        category: "공지",
        content: (p.noticeContent ?? "").trim() || "공지",
        submit: "",
        link: "",
      });
      continue;
    }

    if (leafId.startsWith("wrongnote_")) {
      const link = (p.wrongNoteLink ?? "").trim();
      rows.push({
        period,
        sessionIndex: session.index,
        category: "오답노트",
        content: "오답노트",
        submit: asSubmit(Boolean(p.wrongNoteDone)),
        link,
      });
      continue;
    }

    if (leafId.startsWith("custom_")) {
      const link = (p.solveLink ?? "").trim();
      rows.push({
        period,
        sessionIndex: session.index,
        category: "문제",
        content: (p.customTitle ?? "").trim() || "문제",
        submit: asSubmit(Boolean(p.solveDone)),
        link,
      });
      continue;
    }

    const meta = leafMetaMap.get(leafId);
    const lectureTitle = meta?.title ?? "강의";

    rows.push({
      period,
      sessionIndex: session.index,
      category: "강의",
      content: lectureTitle,
      submit: asSubmit(Boolean(p.noteDone)),
      link: (p.noteLink ?? "").trim(),
    });

    rows.push({
      period,
      sessionIndex: session.index,
      category: "문제",
      content: `${lectureTitle} 문제`,
      submit: asSubmit(Boolean(p.solveDone)),
      link: (p.solveLink ?? "").trim(),
    });
  }

  return rows;
}

function buildRowsForStudent(args: {
  student: Student;
  sessions: Session[];
  stateKv: Record<string, string>;
  leafMetaMap: Map<string, LeafMeta>;
}): string[][] {
  const sortedSessions = [...args.sessions].sort((a, b) => a.index - b.index);
  const rows: string[][] = [];

  for (const session of sortedSessions) {
    const scoped = buildRowsForSession({
      session,
      student: args.student,
      stateKv: args.stateKv,
      leafMetaMap: args.leafMetaMap,
    });

    for (const row of scoped) {
      rows.push([
        row.period,
        String(row.sessionIndex),
        row.category,
        row.submit,
        row.content,
        row.link,
      ]);
    }
  }

  return rows;
}

function rgb(red: number, green: number, blue: number) {
  return { red, green, blue };
}

function makeConditionalFormatRequests(sheetId: number, existingCount: number): unknown[] {
  const requests: unknown[] = [];

  for (let i = existingCount - 1; i >= 0; i -= 1) {
    requests.push({
      deleteConditionalFormatRule: {
        sheetId,
        index: i,
      },
    });
  }

  requests.push({
    addConditionalFormatRule: {
      index: 0,
      rule: {
        ranges: [
          {
            sheetId,
            startRowIndex: 3,
            startColumnIndex: 3,
            endColumnIndex: 4,
          },
        ],
        booleanRule: {
          condition: {
            type: "TEXT_EQ",
            values: [{ userEnteredValue: "F" }],
          },
          format: {
            backgroundColor: rgb(1, 0.9, 0.9),
          },
        },
      },
    },
  });

  const categoryFormats: Array<{ text: string; color: { red: number; green: number; blue: number } }> = [
    { text: "강의", color: rgb(0.89, 0.95, 1) },
    { text: "문제", color: rgb(1, 0.97, 0.86) },
    { text: "오답노트", color: rgb(0.9, 0.98, 0.9) },
    { text: "공지", color: rgb(0.95, 0.95, 0.95) },
  ];

  for (const row of categoryFormats) {
    requests.push({
      addConditionalFormatRule: {
        index: 0,
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 3,
              startColumnIndex: 0,
              endColumnIndex: 6,
            },
          ],
          booleanRule: {
            condition: {
              type: "CUSTOM_FORMULA",
              values: [{ userEnteredValue: `=$C4=\"${row.text}\"` }],
            },
            format: {
              backgroundColor: row.color,
            },
          },
        },
      },
    });
  }

  return requests;
}

function makeSubmitCheckboxValidationRequests(sheetId: number, rows: string[][]): unknown[] {
  const requests: unknown[] = [];

  requests.push({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 3,
        startColumnIndex: 3,
        endColumnIndex: 4,
      },
      rule: null,
    },
  });

  let runStart = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const submit = (rows[i]?.[3] ?? "").trim();
    const eligible = submit === "T" || submit === "F";
    if (eligible && runStart < 0) {
      runStart = i;
    }

    const shouldClose = runStart >= 0 && (!eligible || i === rows.length - 1);
    if (!shouldClose) continue;

    const endIndex = eligible && i === rows.length - 1 ? i + 1 : i;
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 3 + runStart,
          endRowIndex: 3 + endIndex,
          startColumnIndex: 3,
          endColumnIndex: 4,
        },
        rule: {
          condition: {
            type: "BOOLEAN",
            values: [{ userEnteredValue: "T" }, { userEnteredValue: "F" }],
          },
          strict: true,
          showCustomUi: true,
        },
      },
    });
    runStart = -1;
  }

  return requests;
}

async function upsertTeacherSheetMap(args: {
  teacherId: string;
  nextValue: TeacherSheetMap;
}): Promise<void> {
  const cfg = getSupabaseAdminConfig();
  if (!cfg) {
    throw new Error("supabase_admin_config_missing");
  }

  const fetchUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  fetchUrl.searchParams.set("select", "state_kv");
  fetchUrl.searchParams.set("id", `eq.${SNAPSHOT_ID}`);
  fetchUrl.searchParams.set("limit", "1");

  const currentRes = await fetch(fetchUrl.toString(), {
    method: "GET",
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
    },
    cache: "no-store",
  });
  if (!currentRes.ok) {
    throw new Error(`teacher_sheet_map_fetch_failed:${currentRes.status}`);
  }

  const rows = (await currentRes.json()) as Array<{ state_kv?: SnapshotStateKvRaw | null }>;
  const stateKvRaw = rows[0]?.state_kv;
  const merged: SnapshotStateKvRaw =
    stateKvRaw && typeof stateKvRaw === "object" ? { ...stateKvRaw } : {};

  merged[teacherMapKey(args.teacherId)] = JSON.stringify(args.nextValue);

  const writeUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  writeUrl.searchParams.set("on_conflict", "id");

  const writeRes = await fetch(writeUrl.toString(), {
    method: "POST",
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify([
      {
        id: SNAPSHOT_ID,
        state_kv: merged,
      },
    ]),
    cache: "no-store",
  });

  if (!writeRes.ok) {
    const text = await writeRes.text();
    throw new Error(`teacher_sheet_map_upsert_failed:${writeRes.status}:${text}`);
  }
}

async function fetchTeacherSheetMapFromSnapshotByTeacherId(teacherId: string): Promise<TeacherSheetMap | null> {
  const cfg = getSupabaseAdminConfig();
  if (!cfg) {
    throw new Error("supabase_admin_config_missing");
  }

  const fetchUrl = new URL("/rest/v1/app_state_snapshots", cfg.url);
  fetchUrl.searchParams.set("select", "state_kv");
  fetchUrl.searchParams.set("id", `eq.${SNAPSHOT_ID}`);
  fetchUrl.searchParams.set("limit", "1");

  const res = await fetch(fetchUrl.toString(), {
    method: "GET",
    headers: {
      apikey: cfg.serviceRoleKey,
      Authorization: `Bearer ${cfg.serviceRoleKey}`,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`teacher_sheet_map_fetch_failed:${res.status}`);
  }

  const rows = (await res.json()) as Array<{ state_kv?: SnapshotStateKvRaw | null }>;
  const stateKvRaw = rows[0]?.state_kv;
  if (!stateKvRaw || typeof stateKvRaw !== "object") return null;

  return parseTeacherSheetMapValue(stateKvRaw[teacherMapKey(teacherId)]);
}

async function ensureTeacherSpreadsheet(args: {
  teacher: Teacher;
  snapshotStateKv: Record<string, string>;
}): Promise<TeacherSheetMap> {
  const ownerEmail = getOwnerEmail();
  if (!ownerEmail) {
    throw new Error("google_owner_oauth_not_configured");
  }

  const mapKey = teacherMapKey(args.teacher.id);
  const fromViewerSnapshot = parseTeacherSheetMapValue(args.snapshotStateKv[mapKey] ?? null);
  const existing =
    fromViewerSnapshot ?? (await fetchTeacherSheetMapFromSnapshotByTeacherId(args.teacher.id));
  if (existing?.spreadsheetId) {
    const nextValue: TeacherSheetMap = {
      ...existing,
      updatedAt: new Date().toISOString(),
    };
    await upsertTeacherSheetMap({ teacherId: args.teacher.id, nextValue });
    return nextValue;
  }

  const title = `학습현황_${args.teacher.name}`;
  const created = await createSpreadsheet({ title });

  const parentFolderId = getParentFolderId();
  if (parentFolderId) {
    try {
      await moveFileToFolder({
        fileId: created.spreadsheetId,
        targetFolderId: parentFolderId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      const normalized = message.toLowerCase();
      const ignorable =
        normalized.includes("the specified parent is not a folder") ||
        normalized.includes("file not found") ||
        normalized.includes("insufficient file permissions");
      if (ignorable) {
        console.warn(
          `[learning-sheet] parent folder move skipped: ${message} (GOOGLE_SHEETS_PARENT_FOLDER_ID=${parentFolderId})`
        );
      } else {
        throw error;
      }
    }
  }

  await ensureWriterPermission({
    fileId: created.spreadsheetId,
    email: ownerEmail,
    sendNotificationEmail: false,
  });

  const teacherEmail = (args.teacher.email ?? "").trim();
  if (teacherEmail) {
    await ensureWriterPermission({
      fileId: created.spreadsheetId,
      email: teacherEmail,
      sendNotificationEmail: false,
    });
  }

  const nowIso = new Date().toISOString();
  const nextValue: TeacherSheetMap = {
    teacherId: args.teacher.id,
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl,
    title,
    ownerEmail,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  await upsertTeacherSheetMap({ teacherId: args.teacher.id, nextValue });
  return nextValue;
}

async function ensureSheetForStudent(args: {
  spreadsheetId: string;
  student: Student;
  usedTitles: Set<string>;
}): Promise<{ sheetId: number; title: string; existingConditionalCount: number }> {
  const desired = composeStudentTabName(args.student);
  const meta = await getSpreadsheetSheets({ spreadsheetId: args.spreadsheetId });

  const existing = meta.sheets.find((sheet) => sheet.title === desired);
  if (existing) {
    args.usedTitles.add(existing.title);
    return {
      sheetId: existing.sheetId,
      title: existing.title,
      existingConditionalCount: existing.conditionalRuleCount,
    };
  }

  const nextTitle = ensureUniqueSheetTitle(desired, args.usedTitles);
  await sheetsBatchUpdate({
    spreadsheetId: args.spreadsheetId,
    requests: [
      {
        addSheet: {
          properties: {
            title: nextTitle,
          },
        },
      },
    ],
  });

  const refreshed = await getSpreadsheetSheets({ spreadsheetId: args.spreadsheetId });
  const created = refreshed.sheets.find((sheet) => sheet.title === nextTitle);
  if (!created) {
    throw new Error(`student_sheet_create_failed:${nextTitle}`);
  }

  return {
    sheetId: created.sheetId,
    title: created.title,
    existingConditionalCount: created.conditionalRuleCount,
  };
}

async function writeStudentSheet(args: {
  spreadsheetId: string;
  sheetId: number;
  sheetTitle: string;
  rows: string[][];
  teacherName: string;
  existingConditionalCount: number;
  statusMessage: string;
}): Promise<void> {
  await sheetsValuesClear({
    spreadsheetId: args.spreadsheetId,
    range: `${args.sheetTitle}!A1:F`,
  });

  const nowKst = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());

  const values: string[][] = [
    ["마지막 동기화", `${nowKst} (KST)`, "담당 선생님", args.teacherName],
    ["최근 상태", args.statusMessage],
    HEADER_ROW,
    ...args.rows,
  ];

  await sheetsValuesUpdate({
    spreadsheetId: args.spreadsheetId,
    range: `${args.sheetTitle}!A1`,
    values,
  });

  const formatRequests: unknown[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId: args.sheetId,
          gridProperties: {
            frozenRowCount: 3,
          },
        },
        fields: "gridProperties.frozenRowCount",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: args.sheetId,
          startRowIndex: 2,
          endRowIndex: 3,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(0.1, 0.1, 0.1),
            textFormat: {
              foregroundColor: rgb(1, 1, 1),
              bold: true,
            },
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: args.sheetId,
          startRowIndex: 0,
          endRowIndex: 2,
          startColumnIndex: 0,
          endColumnIndex: 6,
        },
        cell: {
          userEnteredFormat: {
            textFormat: {
              bold: true,
            },
          },
        },
        fields: "userEnteredFormat.textFormat.bold",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId: args.sheetId,
          startRowIndex: 3,
          startColumnIndex: 1,
          endColumnIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            horizontalAlignment: "CENTER",
          },
        },
        fields: "userEnteredFormat.horizontalAlignment",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: args.sheetId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: 1,
        },
        properties: {
          pixelSize: 75,
        },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: args.sheetId,
          dimension: "COLUMNS",
          startIndex: 1,
          endIndex: 2,
        },
        properties: {
          pixelSize: 30,
        },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: args.sheetId,
          dimension: "COLUMNS",
          startIndex: 2,
          endIndex: 3,
        },
        properties: {
          pixelSize: 75,
        },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: args.sheetId,
          dimension: "COLUMNS",
          startIndex: 3,
          endIndex: 4,
        },
        properties: {
          pixelSize: 21,
        },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: args.sheetId,
          dimension: "COLUMNS",
          startIndex: 4,
          endIndex: 5,
        },
        properties: {
          pixelSize: 300,
        },
        fields: "pixelSize",
      },
    },
    {
      updateDimensionProperties: {
        range: {
          sheetId: args.sheetId,
          dimension: "COLUMNS",
          startIndex: 5,
          endIndex: 6,
        },
        properties: {
          pixelSize: 75,
        },
        fields: "pixelSize",
      },
    },
  ];

  formatRequests.push(...makeConditionalFormatRequests(args.sheetId, args.existingConditionalCount));
  formatRequests.push(...makeSubmitCheckboxValidationRequests(args.sheetId, args.rows));

  await sheetsBatchUpdate({
    spreadsheetId: args.spreadsheetId,
    requests: formatRequests,
  });
}

export async function syncLearningSheetForTeacher(args: {
  teacher: Teacher;
  students: Student[];
  sessions: Session[];
  stateKv: Record<string, string>;
  onlyStudentId?: string | null;
  onlyTabTitle?: string | null;
}): Promise<LearningSheetSyncResult> {
  assertOwnerOAuthReady();

  const sheetMap = await ensureTeacherSpreadsheet({
    teacher: args.teacher,
    snapshotStateKv: args.stateKv,
  });

  const usedTitles = new Set<string>();
  const leafMetaMap = parseLectureLeafMap(args.stateKv["mk3:lectureTree"] ?? null);

  const targetStudents = args.students
    .filter((student) => student.teacherId === args.teacher.id)
    .filter((student) => (args.onlyStudentId ? student.id === args.onlyStudentId : true));

  let filteredStudents = targetStudents;
  if (args.onlyTabTitle) {
    filteredStudents = filteredStudents.filter(
      (student) => composeStudentTabName(student) === args.onlyTabTitle
    );
  }

  let rowsWritten = 0;
  let syncedStudentCount = 0;
  for (const student of filteredStudents) {
    const studentSessions = args.sessions.filter((session) => session.studentId === student.id);
    const rows = buildRowsForStudent({
      student,
      sessions: studentSessions,
      stateKv: args.stateKv,
      leafMetaMap,
    });

    const sheet = await ensureSheetForStudent({
      spreadsheetId: sheetMap.spreadsheetId,
      student,
      usedTitles,
    });

    await writeStudentSheet({
      spreadsheetId: sheetMap.spreadsheetId,
      sheetId: sheet.sheetId,
      sheetTitle: sheet.title,
      rows,
      teacherName: args.teacher.name,
      existingConditionalCount: sheet.existingConditionalCount,
      statusMessage: `정상 동기화 (${rows.length}행)` ,
    });

    syncedStudentCount += 1;
    rowsWritten += rows.length;
  }

  return {
    teacherId: args.teacher.id,
    teacherName: args.teacher.name,
    spreadsheetId: sheetMap.spreadsheetId,
    spreadsheetUrl: sheetMap.spreadsheetUrl,
    syncedStudentCount,
    skippedStudentCount: Math.max(0, targetStudents.length - syncedStudentCount),
    rowsWritten,
  };
}

export async function syncLearningSheetsForAllTeachers(args: {
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
  stateKv: Record<string, string>;
}): Promise<LearningSheetSyncResult[]> {
  const out: LearningSheetSyncResult[] = [];
  const sortedTeachers = [...args.teachers].sort((a, b) => a.name.localeCompare(b.name));

  for (const teacher of sortedTeachers) {
    const hasStudents = args.students.some((student) => student.teacherId === teacher.id);
    if (!hasStudents) continue;
    const row = await syncLearningSheetForTeacher({
      teacher,
      students: args.students,
      sessions: args.sessions,
      stateKv: args.stateKv,
    });
    out.push(row);
  }

  return out;
}
