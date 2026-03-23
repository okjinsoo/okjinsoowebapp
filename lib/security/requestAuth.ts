import type { NextRequest } from "next/server";

import {
  resolveBridgeCookieSecret,
  verifyBridgeCookieValue,
} from "@/lib/auth/bridgeCookieSignature";

export const AUTH_BRIDGE_COOKIE_KEY = "tutorweb_auth_session_bridge_v1";

export type SupabaseAnonConfig = {
  url: string;
  anonKey: string;
};

export type SupabaseAuthUser = {
  id: string | null;
  email: string | null;
};

export type SupabaseBoundRole = "student" | "teacher";
export type SupabaseViewerRole = "guest" | SupabaseBoundRole | "admin";

export type SignedBridgeTokenResult =
  | { kind: "ok"; accessToken: string; cookieLen: number }
  | { kind: "cookie_missing"; cookieLen: number }
  | { kind: "secret_missing"; cookieLen: number }
  | { kind: "cookie_invalid"; cookieLen: number }
  | { kind: "token_missing"; cookieLen: number };

export function getSupabaseAnonConfigFromEnv(): SupabaseAnonConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function parseLegacyCookieAccessToken(rawCookie: string): string | null {
  try {
    const parsed = JSON.parse(rawCookie) as { accessToken?: unknown };
    if (typeof parsed?.accessToken !== "string") return null;
    const token = parsed.accessToken.trim();
    return token || null;
  } catch {
    return null;
  }
}

function parseBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token || null;
}

function buildSupabaseHeaders(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
}): Record<string, string> {
  return {
    apikey: args.cfg.anonKey,
    Authorization: `Bearer ${args.accessToken}`,
  };
}

export async function readSignedBridgeCookieAccessToken(
  request: NextRequest
): Promise<SignedBridgeTokenResult> {
  const rawCookie = request.cookies.get(AUTH_BRIDGE_COOKIE_KEY)?.value ?? "";
  if (!rawCookie) return { kind: "cookie_missing", cookieLen: 0 };

  const cookieLen = rawCookie.length;
  const secret = resolveBridgeCookieSecret();
  if (!secret) return { kind: "secret_missing", cookieLen };

  const verified = await verifyBridgeCookieValue({
    cookieValue: rawCookie,
    secret,
  });
  if (!verified) return { kind: "cookie_invalid", cookieLen };

  const accessToken = verified.accessToken.trim();
  if (!accessToken) return { kind: "token_missing", cookieLen };
  return { kind: "ok", accessToken, cookieLen };
}

export async function resolveAccessTokenFromRequest(
  request: NextRequest,
  options?: {
    allowAuthorizationHeader?: boolean;
    allowLegacyCookieJson?: boolean;
  }
): Promise<string | null> {
  const signed = await readSignedBridgeCookieAccessToken(request);
  if (signed.kind === "ok") return signed.accessToken;

  const rawCookie = request.cookies.get(AUTH_BRIDGE_COOKIE_KEY)?.value ?? "";
  if (rawCookie && (options?.allowLegacyCookieJson ?? true)) {
    const legacyToken = parseLegacyCookieAccessToken(rawCookie);
    if (legacyToken) return legacyToken;
  }

  if (options?.allowAuthorizationHeader ?? true) {
    const bearerToken = parseBearerToken(request);
    if (bearerToken) return bearerToken;
  }

  return null;
}

export async function fetchSupabaseAuthUser(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
}): Promise<SupabaseAuthUser | null> {
  try {
    const res = await fetch(`${args.cfg.url}/auth/v1/user`, {
      method: "GET",
      headers: buildSupabaseHeaders(args),
      cache: "no-store",
    });

    if (!res.ok) return null;

    const body = (await res.json()) as { id?: string; email?: string };
    return {
      id: typeof body.id === "string" ? body.id : null,
      email: typeof body.email === "string" ? body.email : null,
    };
  } catch {
    return null;
  }
}

export async function fetchSupabaseRoleBinding(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
  email: string;
}): Promise<SupabaseBoundRole | null> {
  try {
    const url = new URL("/rest/v1/role_bindings", args.cfg.url);
    url.searchParams.set("select", "role");
    url.searchParams.set("email", `eq.${args.email}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: buildSupabaseHeaders(args),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as Array<{ role?: unknown }>;
    const role = rows[0]?.role;
    if (role === "teacher" || role === "student") return role;
    return null;
  } catch {
    return null;
  }
}

type SnapshotRoleRow = {
  teachers?: Array<{ email?: unknown }>;
  students?: Array<{ googleEmail?: unknown }>;
};

const SNAPSHOT_KEY = "main";

async function fetchSnapshotFallbackRole(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
  email: string;
}): Promise<SupabaseBoundRole | null> {
  try {
    const url = new URL("/rest/v1/app_state_snapshots", args.cfg.url);
    url.searchParams.set("select", "teachers,students");
    url.searchParams.set("id", `eq.${SNAPSHOT_KEY}`);
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: buildSupabaseHeaders(args),
      cache: "no-store",
    });
    if (!res.ok) return null;

    const rows = (await res.json()) as SnapshotRoleRow[];
    const row = rows[0];
    const teachers = Array.isArray(row?.teachers) ? row.teachers : [];
    const students = Array.isArray(row?.students) ? row.students : [];

    const isTeacher = teachers.some((teacher) => {
      const email =
        teacher && typeof teacher.email === "string" ? teacher.email : null;
      return normalizeEmail(email) === args.email;
    });
    if (isTeacher) return "teacher";

    const isStudent = students.some((student) => {
      const email =
        student && typeof student.googleEmail === "string"
          ? student.googleEmail
          : null;
      return normalizeEmail(email) === args.email;
    });
    if (isStudent) return "student";

    return null;
  } catch {
    return null;
  }
}

export async function resolveSupabaseViewerRole(args: {
  cfg: SupabaseAnonConfig;
  accessToken: string;
  email: string | null | undefined;
  adminEmails?: Set<string>;
}): Promise<SupabaseViewerRole> {
  const email = normalizeEmail(args.email);
  if (!email) return "guest";
  if (args.adminEmails?.has(email)) return "admin";

  const roleFromBindings = await fetchSupabaseRoleBinding({
    cfg: args.cfg,
    accessToken: args.accessToken,
    email,
  });
  if (roleFromBindings) return roleFromBindings;

  const fallbackRole = await fetchSnapshotFallbackRole({
    cfg: args.cfg,
    accessToken: args.accessToken,
    email,
  });
  if (fallbackRole) return fallbackRole;

  return "guest";
}
