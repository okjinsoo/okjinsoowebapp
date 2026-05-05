import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  LOCAL_DEV_ADMIN_COOKIE_KEY,
  canUseLocalDevAdminAuth,
} from "@/lib/auth/localDevAuth";

const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

function deny(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "local_admin_login_disabled" },
    { status: 403 }
  );
}

function clearLocalAdminCookie(request: NextRequest, response: NextResponse): void {
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set({
    name: LOCAL_DEV_ADMIN_COOKIE_KEY,
    value: "",
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure,
    httpOnly: true,
  });
}

export function GET(request: NextRequest) {
  if (!canUseLocalDevAdminAuth(request)) return deny();
  const enabled = request.cookies.get(LOCAL_DEV_ADMIN_COOKIE_KEY)?.value === "1";
  return NextResponse.json({ ok: true, enabled });
}

export function POST(request: NextRequest) {
  if (!canUseLocalDevAdminAuth(request)) return deny();

  const secure = request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: LOCAL_DEV_ADMIN_COOKIE_KEY,
    value: "1",
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SEC,
    sameSite: "lax",
    secure,
    httpOnly: true,
  });
  return response;
}

export function DELETE(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  clearLocalAdminCookie(request, response);
  return response;
}

