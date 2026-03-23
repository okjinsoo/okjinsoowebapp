import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import {
  resolveBridgeCookieSecret,
  signBridgeCookiePayload,
  type BridgeCookiePayload,
} from "@/lib/auth/bridgeCookieSignature";

const AUTH_COOKIE_KEY = "tutorweb_auth_session_bridge_v1";
const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

type BridgeBody = {
  accessToken?: unknown;
};

function normalizeNullableString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function setBridgeCookie(request: NextRequest, response: NextResponse, value: string) {
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set({
    name: AUTH_COOKIE_KEY,
    value,
    path: "/",
    maxAge: AUTH_COOKIE_MAX_AGE_SEC,
    sameSite: "lax",
    secure,
    httpOnly: true,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BridgeBody;
    const accessToken = normalizeNullableString(body?.accessToken, 4096);
    if (!accessToken) {
      return NextResponse.json({ ok: false, error: "access_token_missing" }, { status: 400 });
    }

    const secret = resolveBridgeCookieSecret();
    if (!secret) {
      return NextResponse.json({ ok: false, error: "bridge_secret_missing" }, { status: 500 });
    }

    const payload: BridgeCookiePayload = {
      accessToken,
      issuedAt: Date.now(),
    };
    const signedValue = await signBridgeCookiePayload({ payload, secret });

    const response = NextResponse.json({ ok: true });
    setBridgeCookie(request, response, signedValue);
    return response;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
}

export function DELETE(request: NextRequest) {
  const secure = request.nextUrl.protocol === "https:";
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE_KEY,
    value: "",
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure,
    httpOnly: true,
  });
  return response;
}
