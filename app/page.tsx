"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AUTH_EVENT,
  buildGoogleAuthUrl,
  clearAuthSession,
  ensureAuthSession,
  getSupabaseConfig,
  type AuthSession,
} from "@/lib/auth/supabaseAuth";
import {
  canAccessRole,
  resolveUserRole,
  roleLabel,
  type UserRole,
} from "@/lib/auth/roleAuth";

export default function HomePage() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [role, setRole] = useState<UserRole>("guest");
  const [roleLoading, setRoleLoading] = useState(false);
  const [redirectFrom, setRedirectFrom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const from = new URLSearchParams(window.location.search).get("next");
    setRedirectFrom((from ?? "").trim());
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestId = 0;

    const sync = async () => {
      const currentRequestId = ++requestId;
      const next = await ensureAuthSession();
      if (cancelled || currentRequestId !== requestId) return;

      setSession(next);
      if (!next) {
        setRole("guest");
        setRoleLoading(false);
        return;
      }

      setRoleLoading(true);
      const nextRole = await resolveUserRole({
        email: next.email,
        accessToken: next.accessToken,
      });
      if (cancelled || currentRequestId !== requestId) return;
      setRole(nextRole);
      setRoleLoading(false);
    };

    const requestSync = () => {
      void sync();
    };

    requestSync();
    window.addEventListener(AUTH_EVENT, requestSync);
    return () => {
      cancelled = true;
      window.removeEventListener(AUTH_EVENT, requestSync);
    };
  }, []);

  const loginReady = useMemo(() => Boolean(getSupabaseConfig()), []);

  function onClickGoogleLogin() {
    setError("");
    if (!loginReady) {
      setError("환경변수가 비어 있어요. .env 설정을 먼저 해주세요.");
      return;
    }

    setBusy(true);
    const redirectTo = `${window.location.origin}/auth/callback`;
    const url = buildGoogleAuthUrl(redirectTo);
    if (!url) {
      setBusy(false);
      setError("로그인 URL을 만들지 못했어요.");
      return;
    }
    window.location.href = url;
  }

  function onClickLogout() {
    clearAuthSession();
    setSession(null);
    setRole("guest");
    setRoleLoading(false);
  }

  const loggedIn = Boolean(session);

  return (
    <main
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "var(--home-hero-bg)",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 720,
          borderRadius: 18,
          background: "var(--home-card-bg)",
          border: "1px solid var(--surface-border)",
          padding: 24,
          boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 13, color: "var(--text-subtle)", fontWeight: 700 }}>
            OKJINSOO Mathematics
          </div>
          <h1
            style={{
              marginTop: 10,
              fontSize: 30,
              fontWeight: 900,
              lineHeight: 1.25,
              display: "inline-block",
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid var(--surface-border)",
              background: "var(--home-card-sub-bg)",
            }}
          >
            🎉 옥진수학에 오신 것을 환영합니다 !
          </h1>
          <p style={{ marginTop: 10, color: "var(--text-subtle)", lineHeight: 1.6 }}>
            구글 아이디로 로그인해주세요.
          </p>
        </div>

        <div
          style={{
            marginTop: 20,
            border: "1px solid var(--surface-border)",
            borderRadius: 12,
            background: "var(--home-card-sub-bg)",
            padding: 14,
          }}
        >
          {!loggedIn ? (
            <>
              <button
                type="button"
                onClick={onClickGoogleLogin}
                disabled={busy}
                style={{
                  width: "100%",
                  height: 48,
                  borderRadius: 10,
                  border: "1px solid #111827",
                  background: "#111827",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                {busy ? "구글 로그인 화면으로 이동 중..." : "구글로 로그인하기"}
              </button>
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                처음 세팅이라면 `.env` 설정이 먼저 필요합니다.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700 }}>
                로그인 완료: <span style={{ color: "#2563eb" }}>{session?.email ?? "-"}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--text-subtle)" }}>
                현재 권한: <b>{roleLoading ? "확인 중..." : roleLabel(role)}</b>
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {!roleLoading && canAccessRole(role, "admin") ? (
                  <Link
                    href="/a/amain"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid #1d4ed8",
                      borderRadius: 10,
                      color: "#1d4ed8",
                      fontWeight: 800,
                      textDecoration: "none",
                      background: "#eff6ff",
                    }}
                  >
                    관리자 화면으로 이동
                  </Link>
                ) : null}
                {!roleLoading && canAccessRole(role, "teacher") ? (
                  <Link
                    href="/t/tmain"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid #0f766e",
                      borderRadius: 10,
                      color: "#0f766e",
                      fontWeight: 800,
                      textDecoration: "none",
                      background: "#f0fdfa",
                    }}
                  >
                    선생님 화면으로 이동
                  </Link>
                ) : null}
                {!roleLoading && canAccessRole(role, "student") ? (
                  <Link
                    href="/s/smain"
                    style={{
                      padding: "10px 12px",
                      border: "1px solid #7c3aed",
                      borderRadius: 10,
                      color: "#7c3aed",
                      fontWeight: 800,
                      textDecoration: "none",
                      background: "#faf5ff",
                    }}
                  >
                    학생 화면으로 이동
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={onClickLogout}
                  style={{
                    padding: "10px 12px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 10,
                    background: "var(--home-card-bg)",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  로그아웃
                </button>
              </div>
            </>
          )}

          {error ? (
            <div
              style={{
                marginTop: 10,
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#b91c1c",
                padding: "8px 10px",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}
          {redirectFrom && (!loggedIn || (!roleLoading && role === "guest")) ? (
            <div
              style={{
                marginTop: 10,
                borderRadius: 8,
                border: "1px solid #fde68a",
                background: "#fffbeb",
                color: "#92400e",
                padding: "8px 10px",
                fontSize: 13,
              }}
            >
              이전 요청 경로 <code>{redirectFrom}</code> 는 현재 권한으로 접근할 수 없었습니다.
            </div>
          ) : null}
          {loggedIn && !roleLoading && role === "guest" ? (
            <div
              style={{
                marginTop: 10,
                borderRadius: 8,
                border: "1px solid #fecaca",
                background: "#fef2f2",
                color: "#991b1b",
                padding: "8px 10px",
                fontSize: 13,
              }}
            >
              이 계정 이메일은 아직 학생/선생님/관리자로 등록되어 있지 않습니다.
              등록 후 다시 로그인하면 자동으로 권한이 반영됩니다.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
