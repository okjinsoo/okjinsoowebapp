"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { buildGoogleAuthUrl, getSupabaseConfig } from "@/lib/auth/supabaseAuth";
import { loadCurrentRole } from "@/lib/ui/common/roleGateStorage";

function normalizeNextPath(path: string): string {
  const next = path.trim();
  if (!next.startsWith("/") || next.startsWith("//")) return "";
  return next;
}

function buildCallbackRedirectUrl(args: { origin: string; nextPath: string }): string {
  const base = `${args.origin}/auth/callback`;
  if (!args.nextPath) return base;
  return `${base}?next=${encodeURIComponent(args.nextPath)}`;
}

function shouldRequestCalendarScope(nextPath: string): boolean {
  if (nextPath.startsWith("/a") || nextPath.startsWith("/t")) return true;
  const rememberedRole = loadCurrentRole();
  return rememberedRole === "a" || rememberedRole === "t";
}

export default function ReauthPage() {
  const loginReady = useMemo(() => Boolean(getSupabaseConfig()), []);
  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/";
    const search = new URLSearchParams(window.location.search);
    return normalizeNextPath(search.get("next") ?? "") || "/";
  }, []);

  const authUrl = useMemo(() => {
    if (!loginReady || typeof window === "undefined") return null;
    const redirectTo = buildCallbackRedirectUrl({
      origin: window.location.origin,
      nextPath,
    });
    const requestCalendar = shouldRequestCalendarScope(nextPath);
    return buildGoogleAuthUrl(redirectTo, {
      requestCalendar,
    });
  }, [loginReady, nextPath]);

  const error = !loginReady
    ? "환경변수가 비어 있어 자동 재로그인을 시작할 수 없습니다."
    : authUrl
      ? ""
      : "자동 재로그인 URL을 만들지 못했어요. 홈에서 다시 시도해 주세요.";

  useEffect(() => {
    if (!authUrl) return;
    const timer = window.setTimeout(() => {
      window.location.replace(authUrl);
    }, 700);
    return () => {
      window.clearTimeout(timer);
    };
  }, [authUrl]);

  return (
    <main
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        padding: "24px 0",
        width: "100%",
        background: "var(--background)",
      }}
      aria-busy={!error}
      aria-live="polite"
    >
      <section
        style={{
          width: "100%",
          maxWidth: 560,
          border: "1px solid #cbd5e1",
          borderRadius: 14,
          background: "#fff",
          padding: 20,
          boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900, color: "#0f172a" }}>
          권한을 다시 연결하고 있어요
        </h1>
        <p style={{ marginTop: 10, color: "#334155", fontWeight: 700 }}>
          권한이 만료되어 재로그인을 진행합니다. 잠시만 기다려 주세요.
        </p>
        {error ? (
          <>
            <p style={{ marginTop: 10, color: "#b91c1c", fontSize: 14 }}>{error}</p>
            <Link
              href="/"
              style={{
                marginTop: 12,
                display: "inline-block",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                padding: "8px 12px",
                color: "#0f172a",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              홈으로 이동
            </Link>
          </>
        ) : (
          <p style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
            자동으로 Google 로그인 화면으로 이동 중입니다.
          </p>
        )}
      </section>
    </main>
  );
}
