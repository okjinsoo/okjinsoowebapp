import { getSupabaseConfig, loadAuthSession } from "@/lib/auth/supabaseAuth";

export type RoleBindingRole = "student" | "teacher";

type RoleBindingRow = {
  role?: string;
};

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function getAccessToken(explicitToken?: string | null | undefined): string | null {
  const direct = (explicitToken ?? "").trim();
  if (direct) return direct;
  return loadAuthSession()?.accessToken ?? null;
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

  const accessToken = getAccessToken(args.accessToken);
  if (!accessToken) return null;

  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const headers = buildHeaders({ accessToken });
  if (!headers) return null;

  const url = new URL("/rest/v1/role_bindings", cfg.url);
  url.searchParams.set("select", "role");
  url.searchParams.set("email", `eq.${normalizedEmail}`);
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers,
  });

  if (!res.ok) return null;

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

  const accessToken = getAccessToken(args.accessToken);
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

  const res = await fetch(url.toString(), {
    method: "POST",
    headers,
    body: JSON.stringify([
      {
        email: normalizedEmail,
        role: args.role,
      },
    ]),
  });

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

  const accessToken = getAccessToken(args.accessToken);
  if (!accessToken) return;

  const cfg = getSupabaseConfig();
  if (!cfg) return;

  const headers = buildHeaders({ accessToken });
  if (!headers) return;

  const url = new URL("/rest/v1/role_bindings", cfg.url);
  url.searchParams.set("email", `eq.${normalizedEmail}`);

  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers,
  });

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
