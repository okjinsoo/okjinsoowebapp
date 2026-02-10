"use client";

export const AUTH_STORAGE_KEY = "tutorweb_auth_session_v1";
export const AUTH_EVENT = "tutorweb:authUpdated";

export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  userId: string | null;
  email: string | null;
  provider: "google";
};

export type OAuthHashResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  error: string | null;
  errorDescription: string | null;
};

type SupabaseConfig = {
  url: string;
  anonKey: string;
};

type RefreshTokenResponse = {
  access_token?: string;
  refresh_token?: string | null;
  expires_in?: number;
  user?: {
    id?: string;
    email?: string;
  };
};

const REFRESH_SKEW_MS = 60 * 1000;
let refreshInFlight: Promise<AuthSession | null> | null = null;

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function buildGoogleAuthUrl(redirectTo: string): string | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const url = new URL("/auth/v1/authorize", cfg.url);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);
  url.searchParams.set("scopes", "email profile");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export function parseOAuthHash(hash: string): OAuthHashResult | null {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return null;

  const p = new URLSearchParams(raw);
  const accessToken = p.get("access_token");
  if (!accessToken) return null;

  const expiresInRaw = Number(p.get("expires_in") ?? "");
  const expiresIn = Number.isFinite(expiresInRaw) ? Math.max(0, Math.floor(expiresInRaw)) : null;

  return {
    accessToken,
    refreshToken: p.get("refresh_token"),
    expiresIn,
    error: p.get("error"),
    errorDescription: p.get("error_description"),
  };
}

export async function fetchSupabaseUser(args: { accessToken: string }): Promise<{ id: string | null; email: string | null }> {
  const cfg = getSupabaseConfig();
  if (!cfg) throw new Error("Supabase 환경변수가 비어 있어요.");

  const res = await fetch(`${cfg.url}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: cfg.anonKey,
      Authorization: `Bearer ${args.accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error("사용자 정보를 가져오지 못했어요.");
  }

  const body = (await res.json()) as { id?: string; email?: string };
  return {
    id: typeof body.id === "string" ? body.id : null,
    email: typeof body.email === "string" ? body.email : null,
  };
}

function isAuthSession(v: unknown): v is AuthSession {
  if (!v || typeof v !== "object") return false;
  const s = v as Partial<AuthSession>;
  return typeof s.accessToken === "string" && s.provider === "google";
}

export function loadAuthSession(): AuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveAuthSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  dispatchAuthUpdated();
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_STORAGE_KEY);
  dispatchAuthUpdated();
}

export function isSessionExpired(session: AuthSession | null): boolean {
  if (!session) return true;
  if (session.expiresAt === null) return false;
  return Date.now() >= session.expiresAt;
}

function shouldRefreshSession(session: AuthSession): boolean {
  if (session.expiresAt === null) return false;
  return Date.now() + REFRESH_SKEW_MS >= session.expiresAt;
}

async function refreshAuthSessionOnce(session: AuthSession): Promise<AuthSession | null> {
  const cfg = getSupabaseConfig();
  if (!cfg || !session.refreshToken) return null;

  const url = new URL("/auth/v1/token", cfg.url);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: session.refreshToken,
    }),
  });

  if (!res.ok) return null;

  const body = (await res.json()) as RefreshTokenResponse;
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) return null;

  const expiresInRaw = Number(body.expires_in ?? "");
  const expiresIn = Number.isFinite(expiresInRaw) ? Math.max(0, Math.floor(expiresInRaw)) : null;

  const next: AuthSession = {
    accessToken,
    refreshToken:
      typeof body.refresh_token === "string" && body.refresh_token.trim()
        ? body.refresh_token
        : session.refreshToken,
    expiresAt: expiresIn === null ? null : Date.now() + expiresIn * 1000,
    userId: typeof body.user?.id === "string" ? body.user.id : session.userId,
    email: typeof body.user?.email === "string" ? body.user.email : session.email,
    provider: "google",
  };

  saveAuthSession(next);
  return next;
}

export async function ensureAuthSession(): Promise<AuthSession | null> {
  const session = loadAuthSession();
  if (!session) return null;
  if (!shouldRefreshSession(session)) return session;

  if (!session.refreshToken) {
    clearAuthSession();
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await refreshAuthSessionOnce(session);
        if (!refreshed) {
          clearAuthSession();
          return null;
        }
        return refreshed;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

export async function getValidAccessToken(): Promise<string | null> {
  const session = await ensureAuthSession();
  return session?.accessToken ?? null;
}

export function dispatchAuthUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}
