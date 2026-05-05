import type { NextRequest } from "next/server";

export const LOCAL_DEV_ADMIN_COOKIE_KEY = "tutorweb_local_admin_session_v1";
export const LOCAL_DEV_ADMIN_EMAIL = "rapah0310@gmail.com";
export const LOCAL_DEV_ADMIN_USER_ID = "local-dev-admin";

function isLoopbackOrPrivateHost(hostname: string): boolean {
  if (!hostname) return false;
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  if (host.startsWith("10.")) return true;
  if (host.startsWith("192.168.")) return true;

  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (!match172) return false;
  const secondOctet = Number(match172[1]);
  return Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

export function isLocalDevAdminAuthEnabled(): boolean {
  if (process.env.TUTORWEB_ISOLATED === "1") return true;
  if (process.env.NEXT_PUBLIC_TUTORWEB_ISOLATED === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export function canUseLocalDevAdminAuth(request: NextRequest): boolean {
  if (!isLocalDevAdminAuthEnabled()) return false;
  return isLoopbackOrPrivateHost(request.nextUrl.hostname);
}

export function hasLocalDevAdminSession(request: NextRequest): boolean {
  if (!canUseLocalDevAdminAuth(request)) return false;
  return request.cookies.get(LOCAL_DEV_ADMIN_COOKIE_KEY)?.value === "1";
}
