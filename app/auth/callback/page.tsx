"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  fetchSupabaseUser,
  getSupabaseConfig,
  parseOAuthHash,
  saveAuthSession,
} from "@/lib/auth/supabaseAuth";

export default function AuthCallbackPage() {
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [message, setMessage] = useState("로그인 정보를 확인하고 있어요...");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const cfg = getSupabaseConfig();
        if (!cfg) {
          throw new Error("환경변수(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)가 비어 있어요.");
        }

        const parsed = parseOAuthHash(window.location.hash);
        if (!parsed) {
          throw new Error(
            "로그인 토큰을 받지 못했어요. Supabase Redirect URL을 '/auth/callback'으로 등록했는지 확인해주세요."
          );
        }

        if (parsed.error) {
          throw new Error(parsed.errorDescription || "구글 로그인 중 오류가 발생했어요.");
        }

        const user = await fetchSupabaseUser({ accessToken: parsed.accessToken });
        const expiresAt =
          parsed.expiresIn === null ? null : Date.now() + parsed.expiresIn * 1000;

        saveAuthSession({
          accessToken: parsed.accessToken,
          refreshToken: parsed.refreshToken,
          expiresAt,
          userId: user.id,
          email: user.email,
          provider: "google",
        });

        if (cancelled) return;
        setStatus("done");
        setMessage("로그인이 완료됐어요. 홈으로 이동합니다.");
        setTimeout(() => {
          window.location.replace("/");
        }, 700);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "로그인 처리 중 알 수 없는 오류가 발생했어요.";
        setStatus("error");
        setMessage(msg);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 560,
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          background: "var(--surface-bg)",
          padding: 20,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>
          {status === "loading" ? "로그인 확인 중" : status === "done" ? "로그인 성공" : "로그인 오류"}
        </h1>
        <p style={{ marginTop: 10, color: "#475569", lineHeight: 1.6 }}>{message}</p>
        {status === "error" ? (
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
            홈으로 돌아가기
          </Link>
        ) : null}
      </section>
    </main>
  );
}
