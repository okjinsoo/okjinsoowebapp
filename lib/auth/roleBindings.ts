import { ensureAuthSession, forceRefreshAuthSession, getSupabaseConfig, loadAuthSession } from "@/lib/auth/supabaseAuth";

export type RoleBindingRole = "student" | "teacher";

type RoleBindingRow = {
  role?: string;
};

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function isJwtAuthError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return lower.includes("jwt expired") || lower.includes("invalid jwt") || lower.includes("jwt");
}

async function getAccessToken(
  explicitToken?: string | null | undefined,
  options?: { forceRefresh?: boolean }
): Promise<string | null> {
  const direct = (explicitToken ?? "").trim();
  const current = loadAuthSession();

  if (options?.forceRefresh) {
    const refreshed = await forceRefreshAuthSession();
    if (refreshed?.accessToken) return refreshed.accessToken;
  }

  // 외부에서 전달된 별도 토큰(세션 토큰과 다름)이면 그대로 사용
  if (direct && direct !== (current?.accessToken ?? "")) return direct;

  const ensured = await ensureAuthSession();
  if (ensured?.accessToken) return ensured.accessToken;

  return direct || null;
}

type HeadersArgs = {
  accessToken: string;
  contentType?: boolean;
  preferMerge?: boolean;
};

function buildHeaders(args: HeadersArgs): Record<string, string> | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const headers: Record<string, string> = {
    apikey: cfg.anonKey,
    Authorization: `Bearer ${args.accessToken}`,
  };

  if (args.contentType) headers["Content-Type"] = "application/json";
  if (args.preferMerge) headers.Prefer = "resolution=merge-duplicates";
  return headers;
}

export async function fetchRoleBinding(args: {
  email: string;
  accessToken: string | null | undefined;
}): Promise<RoleBindingRole | null> {
  const normalizedEmail = normalizeEmail(args.email);
  if (!normalizedEmail) return null;

  const accessToken = await getAccessToken(args.accessToken);
  if (!accessToken) return null;

  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const headers = buildHeaders({ accessToken });
  if (!headers) return null;

  const url = new URL("/rest/v1/role_bindings", cfg.url);
  url.searchParams.set("select", "role");
  url.searchParams.set("email", `eq.${normalizedEmail}`);
  url.searchParams.set("limit", "1");

  const execute = async (reqHeaders: Record<string, string>) =>
    fetch(url.toString(), {
      method: "GET",
      headers: reqHeaders,
    });

  let res = await execute(headers);
  if (!res.ok && res.status === 401) {
    const firstText = await res.text();
    if (isJwtAuthError(firstText)) {
      const retryToken = await getAccessToken(args.accessToken, { forceRefresh: true });
      if (retryToken && retryToken !== accessToken) {
        const retryHeaders = buildHeaders({ accessToken: retryToken });
        if (retryHeaders) {
          res = await execute(retryHeaders);
        }
      } else {
        throw new Error(`role_bindings fetch failed: 401 ${firstText}`);
      }
    } else {
      throw new Error(`role_bindings fetch failed: 401 ${firstText}`);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`role_bindings fetch failed: ${res.status} ${text}`);
  }

  const rows = (await res.json()) as RoleBindingRow[];
  const role = rows[0]?.role;
  if (role === "teacher" || role === "student") return role;
  return null;
}

export async function upsertRoleBinding(args: {
  email: string;
  role: RoleBindingRole;
  accessToken?: string | null;
}): Promise<void> {
  const normalizedEmail = normalizeEmail(args.email);
  if (!normalizedEmail) return;

  const accessToken = await getAccessToken(args.accessToken);
  if (!accessToken) return;

  const cfg = getSupabaseConfig();
  if (!cfg) return;

  const headers = buildHeaders({
    accessToken,
    contentType: true,
    preferMerge: true,
  });
  if (!headers) return;

  const url = new URL("/rest/v1/role_bindings", cfg.url);
  url.searchParams.set("on_conflict", "email");

  const body = JSON.stringify([
    {
      email: normalizedEmail,
      role: args.role,
    },
  ]);

  const execute = async (reqHeaders: Record<string, string>) =>
    fetch(url.toString(), {
      method: "POST",
      headers: reqHeaders,
      body,
    });

  let res = await execute(headers);
  if (!res.ok && res.status === 401) {
    const firstText = await res.text();
    if (isJwtAuthError(firstText)) {
      const retryToken = await getAccessToken(args.accessToken, { forceRefresh: true });
      if (retryToken && retryToken !== accessToken) {
        const retryHeaders = buildHeaders({
          accessToken: retryToken,
          contentType: true,
          preferMerge: true,
        });
        if (retryHeaders) {
          res = await execute(retryHeaders);
        }
      } else {
        throw new Error(`role_bindings upsert failed: 401 ${firstText}`);
      }
    } else {
      throw new Error(`role_bindings upsert failed: 401 ${firstText}`);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`role_bindings upsert failed: ${res.status} ${text}`);
  }
}

export async function deleteRoleBinding(args: {
  email: string;
  accessToken?: string | null;
}): Promise<void> {
  const normalizedEmail = normalizeEmail(args.email);
  if (!normalizedEmail) return;

  const accessToken = await getAccessToken(args.accessToken);
  if (!accessToken) return;

  const cfg = getSupabaseConfig();
  if (!cfg) return;

  const headers = buildHeaders({ accessToken });
  if (!headers) return;

  const url = new URL("/rest/v1/role_bindings", cfg.url);
  url.searchParams.set("email", `eq.${normalizedEmail}`);

  const execute = async (reqHeaders: Record<string, string>) =>
    fetch(url.toString(), {
      method: "DELETE",
      headers: reqHeaders,
    });

  let res = await execute(headers);
  if (!res.ok && res.status === 401) {
    const firstText = await res.text();
    if (isJwtAuthError(firstText)) {
      const retryToken = await getAccessToken(args.accessToken, { forceRefresh: true });
      if (retryToken && retryToken !== accessToken) {
        const retryHeaders = buildHeaders({ accessToken: retryToken });
        if (retryHeaders) {
          res = await execute(retryHeaders);
        }
      } else {
        throw new Error(`role_bindings delete failed: 401 ${firstText}`);
      }
    } else {
      throw new Error(`role_bindings delete failed: 401 ${firstText}`);
    }
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`role_bindings delete failed: ${res.status} ${text}`);
  }
}

export async function syncRoleBindingEmails(args: {
  previousEmails: string[];
  nextEmails: string[];
  role: RoleBindingRole;
  accessToken?: string | null;
}): Promise<void> {
  const previous = new Set(args.previousEmails.map(normalizeEmail).filter(Boolean));
  const next = new Set(args.nextEmails.map(normalizeEmail).filter(Boolean));

  // 전체 upsert로 유지하면, 기존 데이터(마이그레이션 이전에 이미 있던 학생/선생님)도
  // 저장 동작 한 번만으로 role_bindings를 복구할 수 있다.
  const toUpsert = Array.from(next);
  const toDelete = Array.from(previous).filter((email) => !next.has(email));

  await Promise.all([
    ...toUpsert.map((email) =>
      upsertRoleBinding({
        email,
        role: args.role,
        accessToken: args.accessToken,
      })
    ),
    ...toDelete.map((email) =>
      deleteRoleBinding({
        email,
        accessToken: args.accessToken,
      })
    ),
  ]);
}
