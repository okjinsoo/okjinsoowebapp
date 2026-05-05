import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { canAccessRole, requiredRoleByPathname } from "@/lib/auth/accessPolicy";
import { hasLocalDevAdminSession } from "@/lib/auth/localDevAuth";
import { logSecurityEvent } from "@/lib/security/securityLog";
import {
  AUTH_BRIDGE_COOKIE_KEY,
  fetchSupabaseAuthUser,
  getSupabaseAnonConfigFromEnv,
  readSignedBridgeCookieAccessToken,
  resolveSupabaseViewerRole,
} from "@/lib/security/requestAuth";

const FIXED_ADMIN_EMAILS = new Set(["rapah0310@gmail.com"]);

type RejectReason =
  | "SECRET_MISSING"
  | "SUPABASE_CONFIG_MISSING"
  | "COOKIE_MISSING"
  | "COOKIE_SIGNATURE_INVALID"
  | "TOKEN_MISSING"
  | "TOKEN_INVALID"
  | "ADMIN_FORBIDDEN"
  | "ROLE_FORBIDDEN";

function requestIdOf(request: NextRequest): string {
  return (
    request.headers.get("x-vercel-id") ??
    request.headers.get("x-request-id") ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

function shortUserAgent(request: NextRequest): string {
  return (request.headers.get("user-agent") ?? "").slice(0, 160);
}

function logReject(args: {
  request: NextRequest;
  requestId: string;
  reason: RejectReason;
  cookieLen: number;
  actorEmail?: string | null;
}) {
  logSecurityEvent({
    level: args.reason === "ADMIN_FORBIDDEN" ? "error" : "warn",
    message: "Access denied",
    requestId: args.requestId,
    route: args.request.nextUrl.pathname,
    reason: args.reason,
    actorEmail: args.actorEmail ?? null,
    extra: {
      userAgent: shortUserAgent(args.request),
      cookieLen: args.cookieLen,
    },
  });
}

function redirectHome(args: {
  request: NextRequest;
  clearAuthCookie?: boolean;
}): NextResponse {
  const response = NextResponse.redirect(new URL("/", args.request.url));
  if (args.clearAuthCookie) {
    response.cookies.set({
      name: AUTH_BRIDGE_COOKIE_KEY,
      value: "",
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      secure: args.request.nextUrl.protocol === "https:",
      httpOnly: true,
    });
  }
  return response;
}

/**
 * [Phase 23] 보안 미들웨어
 * 관리자(/a), 선생님(/t), 학생(/s) 경로에 대해 로그인 세션 및 권한을 검사합니다.
 * 뻔한 URL 접근을 통한 데이터 노출을 원천 차단합니다.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = requestIdOf(request);
  const requiredRole = requiredRoleByPathname(pathname);
  if (!requiredRole) {
    return NextResponse.next();
  }

  // 분리 테스트 서버에서는 로컬 관리자 세션 쿠키로 즉시 통과를 허용합니다.
  if (hasLocalDevAdminSession(request)) {
    return NextResponse.next();
  }

  const signedTokenResult = await readSignedBridgeCookieAccessToken(request);
  if (signedTokenResult.kind === "cookie_missing") {
    logReject({
      request,
      requestId,
      reason: "COOKIE_MISSING",
      cookieLen: signedTokenResult.cookieLen,
    });
    return redirectHome({ request });
  }
  if (signedTokenResult.kind === "secret_missing") {
    logReject({
      request,
      requestId,
      reason: "SECRET_MISSING",
      cookieLen: signedTokenResult.cookieLen,
    });
    return redirectHome({ request, clearAuthCookie: true });
  }
  if (signedTokenResult.kind === "cookie_invalid") {
    logReject({
      request,
      requestId,
      reason: "COOKIE_SIGNATURE_INVALID",
      cookieLen: signedTokenResult.cookieLen,
    });
    return redirectHome({ request, clearAuthCookie: true });
  }
  if (signedTokenResult.kind === "token_missing") {
    logReject({
      request,
      requestId,
      reason: "TOKEN_MISSING",
      cookieLen: signedTokenResult.cookieLen,
    });
    return redirectHome({ request, clearAuthCookie: true });
  }
  const accessToken = signedTokenResult.accessToken;
  const cookieLen = signedTokenResult.cookieLen;

  const cfg = getSupabaseAnonConfigFromEnv();
  if (!cfg) {
    logReject({
      request,
      requestId,
      reason: "SUPABASE_CONFIG_MISSING",
      cookieLen,
    });
    return redirectHome({ request, clearAuthCookie: true });
  }

  const user = await fetchSupabaseAuthUser({
    cfg,
    accessToken,
  });
  const serverEmail = (user?.email ?? "").trim().toLowerCase();
  if (!serverEmail) {
    logReject({
      request,
      requestId,
      reason: "TOKEN_INVALID",
      cookieLen,
    });
    return redirectHome({ request, clearAuthCookie: true });
  }

  const role = await resolveSupabaseViewerRole({
    cfg,
    accessToken,
    email: serverEmail,
    adminEmails: FIXED_ADMIN_EMAILS,
  });
  if (!canAccessRole(role, requiredRole)) {
    logReject({
      request,
      requestId,
      reason: requiredRole === "admin" ? "ADMIN_FORBIDDEN" : "ROLE_FORBIDDEN",
      cookieLen,
      actorEmail: serverEmail,
    });
    return redirectHome({ request });
  }

  return NextResponse.next();
}

// 미들웨어가 작동할 경로 설정
export const config = {
  matcher: ["/a/:path*", "/t/:path*", "/s/:path*"],
};
