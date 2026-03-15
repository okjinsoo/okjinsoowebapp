"use client";

import { browserStorage } from "@/lib/storage/browserStorage";

export const AUTH_STORAGE_KEY = "tutorweb_auth_session_v1";
export const AUTH_EVENT = "tutorweb:authUpdated";
const AUTH_COOKIE_KEY = "tutorweb_auth_session_bridge_v1";
const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

export type AuthSession = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  userId: string | null;
  email: string | null;
  provider: "google";
  providerAccessToken?: string | null;
  providerRefreshToken?: string | null;
  providerExpiresAt?: number | null;
};

export type OAuthHashResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  providerToken: string | null;
  providerRefreshToken: string | null;
  providerExpiresIn: number | null;
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
const REFRESH_FAILURE_COOLDOWN_MS = 30 * 1000;
let refreshInFlight: Promise<AuthSession | null> | null = null;
let lastRefreshFailureAt = 0;

function parseAuthSessionRaw(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isAuthSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const chunks = document.cookie ? document.cookie.split("; ") : [];
  for (const chunk of chunks) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const key = decodeURIComponent(chunk.slice(0, idx));
    if (key !== name) continue;
    return decodeURIComponent(chunk.slice(idx + 1));
  }
  return null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(
    0,
    Math.floor(maxAgeSec)
  )}; SameSite=Lax${secure}`;
}

function clearCookie(name: string): void {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function sessionRank(session: AuthSession | null): number {
  if (!session) return Number.NEGATIVE_INFINITY;
  if (session.expiresAt === null) return Date.now();
  return session.expiresAt;
}

function pickPreferredSession(primary: AuthSession | null, secondary: AuthSession | null): AuthSession | null {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const now = Date.now();
  const primaryExpired = primary.expiresAt !== null && now >= primary.expiresAt;
  const secondaryExpired = secondary.expiresAt !== null && now >= secondary.expiresAt;
  if (primaryExpired !== secondaryExpired) {
    return primaryExpired ? secondary : primary;
  }

  return sessionRank(secondary) > sessionRank(primary) ? secondary : primary;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function buildGoogleAuthUrl(redirectTo: string, requestCalendar: boolean = false): string | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  const url = new URL("/auth/v1/authorize", cfg.url);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", redirectTo);

  if (requestCalendar) {
    // 관리자/선생님: 캘린더 관리 및 드라이브 제어를 위해 전체 scope 요청
    url.searchParams.set(
      "scopes",
      "email profile openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.metadata.readonly"
    );
  } else {
    // 학생: 캘린더 권한은 불필요하지만 드라이브 업로드를 위한 권한 추가
    url.searchParams.set(
      "scopes",
      "email profile openid https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.metadata.readonly"
    );
  }
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
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
  const providerExpiresInRawStr = p.get("provider_expires_in") ?? p.get("provider_token_expires_in") ?? "";
  const providerExpiresIn = (providerExpiresInRawStr.trim() && !isNaN(Number(providerExpiresInRawStr)))
    ? Math.max(0, Math.floor(Number(providerExpiresInRawStr)))
    : null;

  const candidateProviderToken =
    p.get("provider_token") ??
    p.get("provider_access_token") ??
    p.get("google_access_token");

  // [위험 방지] Supabase의 access_token(JWT, 보통 'ey'로 시작)이 provider_token으로 오인되는 것을 방지
  const finalProviderToken = candidateProviderToken || (p.get("access_token")?.startsWith("ey") ? null : p.get("access_token"));

  return {
    accessToken,
    refreshToken: p.get("refresh_token"),
    expiresIn,
    providerToken: finalProviderToken,
    providerRefreshToken:
      p.get("provider_refresh_token") ??
      p.get("provider_refresh") ??
      p.get("google_refresh_token") ??
      (p.get("refresh_token")?.length && p.get("refresh_token")!.length < 100 ? p.get("refresh_token") : null), 
    providerExpiresIn,
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
  const storageRaw = browserStorage.getItem(AUTH_STORAGE_KEY);
  const cookieRaw = readCookie(AUTH_COOKIE_KEY);
  const storageSession = parseAuthSessionRaw(storageRaw);
  const cookieSession = parseAuthSessionRaw(cookieRaw);
  const picked = pickPreferredSession(storageSession, cookieSession);
  if (!picked) return null;

  const pickedRaw = JSON.stringify(picked);
  if (storageRaw !== pickedRaw) {
    browserStorage.setItem(AUTH_STORAGE_KEY, pickedRaw);
  }
  if (cookieRaw !== pickedRaw) {
    writeCookie(AUTH_COOKIE_KEY, pickedRaw, AUTH_COOKIE_MAX_AGE_SEC);
  }
  return picked;
}

export function saveAuthSession(session: AuthSession): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(session);
  browserStorage.setItem(AUTH_STORAGE_KEY, raw);
  writeCookie(AUTH_COOKIE_KEY, raw, AUTH_COOKIE_MAX_AGE_SEC);
  dispatchAuthUpdated();
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") return;
  browserStorage.removeItem(AUTH_STORAGE_KEY);
  clearCookie(AUTH_COOKIE_KEY);
  dispatchAuthUpdated();
}

export function isSessionExpired(session: AuthSession | null): boolean {
  if (!session) return true;
  if (session.expiresAt === null) return false;
  return Date.now() >= session.expiresAt;
}

export function isProviderTokenExpired(session: AuthSession | null): boolean {
  if (!session || !session.providerAccessToken) return true;
  if (session.providerExpiresAt === null || session.providerExpiresAt === undefined) return false;
  // 여유 공간 1분
  return Date.now() + 60 * 1000 >= session.providerExpiresAt;
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

  const providerAccessToken = body.access_token && !body.access_token.startsWith("ey") 
    ? body.access_token 
    : session.providerAccessToken;

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
    providerAccessToken: providerAccessToken ?? null,
    providerRefreshToken: session.providerRefreshToken ?? null, // Supabase Refresh Token API는 보통 provider_refresh_token을 주지 않으므로 기존 값 유지
    // [보완] 구글 토큰을 새로 받은 게 아니라면 기존 만료 시간을 유지해야 합니다.
    providerExpiresAt: (providerAccessToken === session.providerAccessToken) 
      ? session.providerExpiresAt ?? null 
      : null, 
  };

  saveAuthSession(next);
  return next;
}

async function refreshSessionWithLock(session: AuthSession, args?: { ignoreCooldown?: boolean }): Promise<AuthSession | null> {
  if (!args?.ignoreCooldown && Date.now() - lastRefreshFailureAt < REFRESH_FAILURE_COOLDOWN_MS) {
    if (session.expiresAt === null || Date.now() < session.expiresAt) {
      return session;
    }
    clearAuthSession();
    return null;
  }

  if (!session.refreshToken) {
    if (session.expiresAt === null || Date.now() < session.expiresAt) {
      return session;
    }
    clearAuthSession();
    return null;
  }

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await refreshAuthSessionOnce(session);
        if (!refreshed) {
          lastRefreshFailureAt = Date.now();
          if (session.expiresAt === null || Date.now() < session.expiresAt) {
            return session;
          }
          clearAuthSession();
          return null;
        }
        lastRefreshFailureAt = 0;
        return refreshed;
      } finally {
        refreshInFlight = null;
      }
    })();
  }

  return refreshInFlight;
}

export async function ensureAuthSession(): Promise<AuthSession | null> {
  const session = loadAuthSession();
  if (!session) return null;
  if (!shouldRefreshSession(session)) return session;
  return refreshSessionWithLock(session);
}

export async function forceRefreshAuthSession(): Promise<AuthSession | null> {
  const session = loadAuthSession();
  if (!session) return null;
  return refreshSessionWithLock(session, { ignoreCooldown: true });
}

export async function getValidAccessToken(): Promise<string | null> {
  const session = await ensureAuthSession();
  return session?.accessToken ?? null;
}

export function dispatchAuthUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EVENT));
}
