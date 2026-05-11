import "server-only";

type OwnerOAuthConfig = {
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
  ownerEmail: string;
  parentFolderId: string | null;
};

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

let tokenCache: TokenCache | null = null;

export type SpreadsheetSummary = {
  spreadsheetId: string;
  spreadsheetUrl: string;
};

export type SheetMeta = {
  sheetId: number;
  title: string;
  conditionalRuleCount: number;
};

function readOwnerOAuthConfig(): OwnerOAuthConfig | null {
  const clientId = (
    process.env.GOOGLE_SHEETS_OAUTH_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? ""
  ).trim();
  const clientSecret = (
    process.env.GOOGLE_SHEETS_OAUTH_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? ""
  ).trim();
  const refreshToken = (
    process.env.GOOGLE_SHEETS_OAUTH_REFRESH_TOKEN ?? process.env.GOOGLE_OAUTH_REFRESH_TOKEN ?? ""
  ).trim();
  const ownerEmail = (
    process.env.GOOGLE_SHEETS_OWNER_EMAIL ?? process.env.GOOGLE_OAUTH_OWNER_EMAIL ?? ""
  ).trim();
  const parentFolderIdRaw = (
    process.env.GOOGLE_SHEETS_PARENT_FOLDER_ID ?? process.env.GOOGLE_OAUTH_PARENT_FOLDER_ID ?? ""
  ).trim();

  if (!clientId || !refreshToken || !ownerEmail) {
    return null;
  }

  return {
    clientId,
    clientSecret: clientSecret || null,
    refreshToken,
    ownerEmail,
    parentFolderId: parentFolderIdRaw || null,
  };
}

export function getOwnerEmail(): string | null {
  return readOwnerOAuthConfig()?.ownerEmail ?? null;
}

export function getParentFolderId(): string | null {
  return readOwnerOAuthConfig()?.parentFolderId ?? null;
}

export function assertOwnerOAuthReady(): void {
  const cfg = readOwnerOAuthConfig();
  if (!cfg) {
    throw new Error(
      "google_owner_oauth_not_configured: GOOGLE_SHEETS_OAUTH_CLIENT_ID/REFRESH_TOKEN/OWNER_EMAIL 필요"
    );
  }
}

async function fetchOwnerAccessToken(): Promise<string> {
  const cfg = readOwnerOAuthConfig();
  if (!cfg) {
    throw new Error(
      "google_owner_oauth_not_configured: GOOGLE_SHEETS_OAUTH_CLIENT_ID/REFRESH_TOKEN/OWNER_EMAIL 필요"
    );
  }

  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs - 60_000 > now) {
    return tokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  });
  if (cfg.clientSecret) {
    body.set("client_secret", cfg.clientSecret);
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  const text = await res.text();
  let payload: {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } = {};
  try {
    payload = JSON.parse(text) as typeof payload;
  } catch {
    payload = {};
  }

  if (!res.ok || !payload.access_token) {
    throw new Error(
      `google_owner_token_refresh_failed: ${res.status} ${payload.error ?? "unknown_error"} ${
        payload.error_description ?? ""
      }`.trim()
    );
  }

  const expiresInSec = Number.isFinite(payload.expires_in) ? Number(payload.expires_in) : 3600;
  tokenCache = {
    accessToken: payload.access_token,
    expiresAtMs: now + Math.max(60, expiresInSec) * 1000,
  };
  return tokenCache.accessToken;
}

async function googleFetchJson<T>(args: {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  url: string;
  body?: unknown;
}): Promise<T> {
  const token = await fetchOwnerAccessToken();
  const res = await fetch(args.url, {
    method: args.method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: args.body === undefined ? undefined : JSON.stringify(args.body),
    cache: "no-store",
  });

  if (res.status === 204) {
    return null as T;
  }

  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    payload = text;
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === "object"
        ? ((payload as { error?: { message?: string } }).error?.message ?? text)
        : text;
    throw new Error(`google_api_failed: ${res.status} ${message}`);
  }

  return payload as T;
}

export async function createSpreadsheet(args: { title: string }): Promise<SpreadsheetSummary> {
  const payload = await googleFetchJson<{ spreadsheetId: string; spreadsheetUrl: string }>({
    method: "POST",
    url: "https://sheets.googleapis.com/v4/spreadsheets",
    body: {
      properties: {
        title: args.title,
      },
    },
  });

  return {
    spreadsheetId: payload.spreadsheetId,
    spreadsheetUrl: payload.spreadsheetUrl,
  };
}

export async function moveFileToFolder(args: {
  fileId: string;
  targetFolderId: string;
}): Promise<void> {
  const parentsMeta = await googleFetchJson<{ parents?: string[] }>({
    method: "GET",
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.fileId)}?fields=parents`,
  });

  const removeParents = Array.isArray(parentsMeta.parents)
    ? parentsMeta.parents.filter((row) => typeof row === "string" && row.trim()).join(",")
    : "";

  const qs = new URLSearchParams({
    addParents: args.targetFolderId,
    fields: "id,parents",
  });
  if (removeParents) qs.set("removeParents", removeParents);

  await googleFetchJson<{ id: string }>({
    method: "PATCH",
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(args.fileId)}?${qs.toString()}`,
    body: {},
  });
}

export async function ensureWriterPermission(args: {
  fileId: string;
  email: string;
  sendNotificationEmail?: boolean;
}): Promise<void> {
  const email = args.email.trim().toLowerCase();
  if (!email) return;

  const existing = await googleFetchJson<{
    permissions?: Array<{ id?: string; emailAddress?: string; role?: string; type?: string }>;
  }>({
    method: "GET",
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      args.fileId
    )}/permissions?fields=permissions(id,emailAddress,role,type)&supportsAllDrives=true`,
  });

  const already =
    existing.permissions?.some(
      (row) =>
        (row.emailAddress ?? "").trim().toLowerCase() === email &&
        (row.role === "writer" || row.role === "owner")
    ) ?? false;
  if (already) return;

  const notify = args.sendNotificationEmail ? "true" : "false";
  await googleFetchJson<{ id: string }>({
    method: "POST",
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      args.fileId
    )}/permissions?supportsAllDrives=true&sendNotificationEmail=${notify}`,
    body: {
      type: "user",
      role: "writer",
      emailAddress: email,
    },
  });
}

export async function getSpreadsheetSheets(args: {
  spreadsheetId: string;
}): Promise<{ sheets: SheetMeta[] }> {
  const payload = await googleFetchJson<{
    sheets?: Array<{
      properties?: { sheetId?: number; title?: string };
      conditionalFormats?: unknown[];
    }>;
  }>({
    method: "GET",
    url:
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}` +
      "?fields=sheets(properties(sheetId,title),conditionalFormats)",
  });

  const sheets: SheetMeta[] = [];
  for (const row of payload.sheets ?? []) {
    const sheetId = Number(row.properties?.sheetId);
    const title = (row.properties?.title ?? "").trim();
    if (!Number.isFinite(sheetId) || !title) continue;
    sheets.push({
      sheetId,
      title,
      conditionalRuleCount: Array.isArray(row.conditionalFormats) ? row.conditionalFormats.length : 0,
    });
  }
  return { sheets };
}

export async function sheetsBatchUpdate(args: {
  spreadsheetId: string;
  requests: unknown[];
}): Promise<void> {
  if (args.requests.length === 0) return;
  await googleFetchJson<{ replies?: unknown[] }>({
    method: "POST",
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}:batchUpdate`,
    body: {
      requests: args.requests,
    },
  });
}

export async function sheetsValuesUpdate(args: {
  spreadsheetId: string;
  range: string;
  values: string[][];
}): Promise<void> {
  await googleFetchJson<unknown>({
    method: "PUT",
    url:
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/` +
      `${encodeURIComponent(args.range)}?valueInputOption=RAW`,
    body: {
      majorDimension: "ROWS",
      values: args.values,
    },
  });
}

export async function sheetsValuesClear(args: {
  spreadsheetId: string;
  range: string;
}): Promise<void> {
  await googleFetchJson<unknown>({
    method: "POST",
    url:
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(args.spreadsheetId)}/values/` +
      `${encodeURIComponent(args.range)}:clear`,
    body: {},
  });
}
