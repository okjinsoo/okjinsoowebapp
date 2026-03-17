import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE_KEY = "tutorweb_auth_session_bridge_v1";
const FIXED_ADMIN_EMAILS = new Set(["rapah0310@gmail.com"]);

/**
 * [Phase 23] 보안 미들웨어
 * 관리자(/a), 선생님(/t), 학생(/s) 경로에 대해 로그인 세션 및 권한을 검사합니다.
 * 뻔한 URL 접근을 통한 데이터 노출을 원천 차단합니다.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 보호 대상 경로 확인
  const isProtectedPath =
    pathname.startsWith("/a") ||
    pathname.startsWith("/t") ||
    pathname.startsWith("/s");

  if (!isProtectedPath) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get(AUTH_COOKIE_KEY)?.value;

  // 1. 세션 쿠키가 없으면 탈락
  if (!authCookie) {
    console.warn(`[Security] Unauthorized access attempt to ${pathname} (No session)`);
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    const auth = JSON.parse(authCookie);
    const email = (auth.email || "").trim().toLowerCase();

    // 2. 이메일 정보가 없으면 탈락
    if (!email) {
      return NextResponse.redirect(new URL("/", request.url));
    }

    // 3. 관리자 전용 경로(/a) 체크
    if (pathname.startsWith("/a")) {
      if (!FIXED_ADMIN_EMAILS.has(email)) {
        console.error(`[Security] Non-admin (${email}) tried to access admin path: ${pathname}`);
        return NextResponse.redirect(new URL("/", request.url));
      }
    }

    // 4. 선생님/학생 등 각 역할별 정밀 체크는 Page 수준과 API 수준에서 진행 (효율성)
    // 미들웨어에서는 "최소한 로그인된 정상 사용자"인지만 1차 필터링합니다.

  } catch (err) {
    console.error("[Security] Middleware error parsing auth cookie", err);
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

// 미들웨어가 작동할 경로 설정
export const config = {
  matcher: ["/a/:path*", "/t/:path*", "/s/:path*"],
};
