"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AUTH_EVENT,
  buildGoogleAuthUrl,
  clearAuthSession,
  ensureAuthSession,
  getSupabaseConfig,
  isProviderTokenExpired,
  loadKeepSignedInPreference,
  saveAuthSession,
  saveKeepSignedInPreference,
  type AuthSession,
} from "@/lib/auth/supabaseAuth";
import {
  canAccessRole,
  resolveUserRole,
  roleLabel,
  type UserRole,
} from "@/lib/auth/roleAuth";
import { requiredRoleByPathname } from "@/lib/auth/accessPolicy";
import { findStudentByLoginEmail } from "@/lib/auth/loginSelection";
import { loadCurrentRole, saveCurrentRole, saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { readStudentsServerFirst } from "@/lib/storage/serverRead";

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

export default function HomePage() {
  const router = useRouter();
  // hydration mismatch 방지: 서버/클라이언트 첫 렌더를 동일하게 guest로 시작
  const [session, setSession] = useState<AuthSession | null>(null);
  const [role, setRole] = useState<UserRole>("guest");
  const [roleLoading, setRoleLoading] = useState(false);
  const [redirectFrom, setRedirectFrom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [autoReauthRequested, setAutoReauthRequested] = useState(false);
  const [isPending, startTransition] = useTransition();
  const studentAutoRedirectedRef = useRef(false);
  const nextAutoRedirectedRef = useRef(false);
  const autoReauthStartedRef = useRef(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const from = search.get("next");
    const reauth = search.get("reauth") === "1";
    setRedirectFrom((from ?? "").trim());
    setAutoReauthRequested(reauth);
  }, []);

  useEffect(() => {
    setKeepSignedIn(loadKeepSignedInPreference());
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

  useEffect(() => {
    if (!session || roleLoading || !canAccessRole(role, "student")) return;
    void router.prefetch("/s/smain");
  }, [session, roleLoading, role, router]);

  useEffect(() => {
    if (!session || roleLoading) return;
    if (canAccessRole(role, "admin")) void router.prefetch("/a/amain");
    if (canAccessRole(role, "teacher")) void router.prefetch("/t/tmain");
  }, [session, roleLoading, role, router]);

  useEffect(() => {
    if (nextAutoRedirectedRef.current) return;
    if (autoReauthRequested) return;
    if (!session || roleLoading || role === "guest") return;

    const nextPath = normalizeNextPath(redirectFrom);
    if (!nextPath) return;

    const requiredRole = requiredRoleByPathname(nextPath);
    if (requiredRole && !canAccessRole(role, requiredRole)) return;

    nextAutoRedirectedRef.current = true;
    setPendingPath(nextPath);
    startTransition(() => {
      router.replace(nextPath);
    });
  }, [session, roleLoading, role, redirectFrom, autoReauthRequested, router, startTransition]);

  useEffect(() => {
    if (studentAutoRedirectedRef.current) return;
    if (autoReauthRequested) return;
    if (normalizeNextPath(redirectFrom)) return;
    if (!session || roleLoading || role !== "student") return;

    let cancelled = false;

    const redirectStudent = async () => {
      const next = await readStudentsServerFirst();
      if (cancelled || studentAutoRedirectedRef.current) return;

      const matchedStudent = findStudentByLoginEmail(next.students);
      if (matchedStudent?.token) {
        saveCurrentStudentToken(matchedStudent.token);
      }
      saveCurrentRole("s");

      studentAutoRedirectedRef.current = true;
      setPendingPath("/s/smain");
      startTransition(() => {
        router.replace("/s/smain");
      });
    };

    void redirectStudent();
    return () => {
      cancelled = true;
    };
  }, [session, roleLoading, role, redirectFrom, autoReauthRequested, router, startTransition]);

  const loginReady = useMemo(() => Boolean(getSupabaseConfig()), []);
  const localDevAdminLoginEnabled = useMemo(
    () => process.env.NEXT_PUBLIC_TUTORWEB_ISOLATED === "1",
    []
  );

  useEffect(() => {
    if (!autoReauthRequested) return;
    if (autoReauthStartedRef.current) return;
    if (session) {
      setAutoReauthRequested(false);
      return;
    }

    autoReauthStartedRef.current = true;
    setError("");

    if (!loginReady) {
      setAutoReauthRequested(false);
      setError("환경변수가 비어 있어 자동 재로그인을 시작할 수 없습니다.");
      return;
    }

    setBusy(true);
    saveKeepSignedInPreference(keepSignedIn);

    const nextPath = normalizeNextPath(redirectFrom);
    const redirectTo = buildCallbackRedirectUrl({ origin: window.location.origin, nextPath });
    const requestCalendar = shouldRequestCalendarScope(nextPath);
    const url = buildGoogleAuthUrl(redirectTo, requestCalendar, { forceConsent: true });
    if (!url) {
      setBusy(false);
      setAutoReauthRequested(false);
      setError("자동 재로그인 URL을 만들지 못했어요. 다시 로그인 버튼을 눌러주세요.");
      return;
    }
    window.location.href = url;
  }, [autoReauthRequested, session, loginReady, keepSignedIn, redirectFrom]);

  function onClickGoogleLogin() {
    setError("");
    if (!loginReady) {
      setError("환경변수가 비어 있어요. .env 설정을 먼저 해주세요.");
      return;
    }

    setBusy(true);
    saveKeepSignedInPreference(keepSignedIn);
    const nextPath = normalizeNextPath(redirectFrom);
    const redirectTo = buildCallbackRedirectUrl({ origin: window.location.origin, nextPath });
    const requestCalendar = shouldRequestCalendarScope(nextPath);
    const url = buildGoogleAuthUrl(redirectTo, requestCalendar);
    if (!url) {
      setBusy(false);
      setError("로그인 URL을 만들지 못했어요.");
      return;
    }
    window.location.href = url;
  }

  function onClickTesterLogin() {
    setError("");
    if (!loginReady) {
      setError("환경변수가 비어 있어요. .env 설정을 먼저 해주세요.");
      return;
    }

    setBusy(true);
    saveKeepSignedInPreference(keepSignedIn);
    const nextPath = normalizeNextPath(redirectFrom);
    const redirectTo = buildCallbackRedirectUrl({ origin: window.location.origin, nextPath });
    // 관리자/테스터 로그인: 캘린더 권한(requestCalendar) TRUE
    const url = buildGoogleAuthUrl(redirectTo, true, { selectAccount: true });
    if (!url) {
      setBusy(false);
      setError("로그인 URL을 만들지 못했어요.");
      return;
    }
    window.location.href = url;
  }

  async function onClickLocalDevAdminLogin() {
    setError("");
    setBusy(true);
    saveKeepSignedInPreference(keepSignedIn);

    try {
      const res = await fetch("/api/auth/local-admin", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) {
        setBusy(false);
        setError("로컬 관리자 로그인은 분리 테스트 서버(4100)에서만 사용할 수 있어요.");
        return;
      }

      saveAuthSession({
        accessToken: "local-dev-admin-access-token",
        refreshToken: null,
        expiresAt: null,
        userId: "local-dev-admin",
        email: "rapah0310@gmail.com",
        provider: "google",
        providerAccessToken: null,
        providerRefreshToken: null,
        providerExpiresAt: null,
      });
      saveCurrentRole("a");

      setBusy(false);
      setPendingPath("/a/amain");
      startTransition(() => {
        router.replace("/a/amain");
      });
    } catch {
      setBusy(false);
      setError("로컬 관리자 로그인 중 오류가 발생했어요.");
    }
  }

  function onClickReconnectGoogleAuth() {
    setError("");
    const nextPath = normalizeNextPath(redirectFrom) || "/";
    const redirectTo = buildCallbackRedirectUrl({ origin: window.location.origin, nextPath });
    const url = buildGoogleAuthUrl(redirectTo, true, { forceConsent: true });
    if (!url) {
      setError("권한 다시 연결 URL을 만들지 못했어요.");
      return;
    }
    window.location.href = url;
  }

  async function onClickLogout() {
    try {
      await fetch("/api/auth/bridge", {
        method: "DELETE",
        credentials: "same-origin",
      });
      await fetch("/api/auth/local-admin", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {
      // 네트워크 오류가 있어도 로컬 세션은 지웁니다.
    }
    clearAuthSession();
    setSession(null);
    setRole("guest");
    setRoleLoading(false);
    window.location.replace("/");
  }

  function onClickStudentMove() {
    setPendingPath("/s/smain");
    startTransition(() => {
      router.push("/s/smain");
    });
  }

  const loggedIn = Boolean(session);
  const studentMovePending = isPending && pendingPath === "/s/smain";

  return (
    <main
      style={{
        minHeight: "calc(100vh - 56px)",
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "var(--background)",
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
        <div style={{ textAlign: "center", paddingTop: 4 }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            OKJINSOO Mathematics
          </div>
          <h1
            style={{
              marginTop: 12,
              fontSize: "clamp(28px, 5vw, 42px)",
              fontWeight: 900,
              lineHeight: 1.18,
              color: "var(--foreground)",
            }}
          >
            📚 옥진수학에 오신 것을 환영합니다!
          </h1>
          <div
            style={{
              margin: "12px auto 0",
              width: 84,
              height: 4,
              borderRadius: 999,
              background: "linear-gradient(90deg, #22c55e 0%, #3b82f6 50%, #f59e0b 100%)",
            }}
          />
          <p style={{ marginTop: 12, color: "var(--text-subtle)", lineHeight: 1.6, fontWeight: 600 }}>
            구글 아이디로 로그인해주세요.
          </p>
        </div>

        <div style={{ marginTop: 20 }}>
          {!loggedIn ? (
            <>
              <div className="google-signin-row">
                <button
                  type="button"
                  className="google-signin-btn"
                  onClick={onClickGoogleLogin}
                  disabled={busy}
                >
                  <span className="google-signin-icon" aria-hidden="true">
                    <GoogleMark />
                  </span>
                  <span>{busy ? "Google 로그인으로 이동 중..." : "Sign in with Google"}</span>
                </button>
              </div>
              {localDevAdminLoginEnabled ? (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={onClickLocalDevAdminLogin}
                    disabled={busy}
                    style={{
                      width: "100%",
                      minHeight: 44,
                      borderRadius: 10,
                      border: "1px dashed #2563eb",
                      background: "#eff6ff",
                      color: "#1d4ed8",
                      fontWeight: 800,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy ? "로컬 관리자 로그인 준비 중..." : "로컬 테스트용 관리자 바로 로그인"}
                  </button>
                </div>
              ) : null}
              <label
                style={{
                  marginTop: 10,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "var(--text-subtle)",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(event) => setKeepSignedIn(event.target.checked)}
                  disabled={busy}
                />
                로그인 유지하기 (권장)
              </label>
              <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                공용 PC라면 체크를 끄면 브라우저를 닫을 때 자동 로그아웃됩니다.
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
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 16px",
                      border: "1px solid #1d4ed8",
                      borderRadius: 10,
                      color: "#1d4ed8",
                      fontWeight: 800,
                      textDecoration: "none",
                      background: "#eff6ff",
                      cursor: "pointer",
                      userSelect: "none",
                      minHeight: 44,
                    }}
                  >
                    관리자 화면으로 이동
                  </Link>
                ) : null}
                {!roleLoading && canAccessRole(role, "teacher") ? (
                  <Link
                    href="/t/tmain"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 16px",
                      border: "1px solid #0f766e",
                      borderRadius: 10,
                      color: "#0f766e",
                      fontWeight: 800,
                      textDecoration: "none",
                      background: "#f0fdfa",
                      cursor: "pointer",
                      userSelect: "none",
                      minHeight: 44,
                    }}
                  >
                    선생님 화면으로 이동
                  </Link>
                ) : null}
                {!roleLoading && canAccessRole(role, "student") ? (
                  <button
                    type="button"
                    onClick={onClickStudentMove}
                    disabled={studentMovePending}
                    aria-busy={studentMovePending}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "10px 16px",
                      border: "1px solid #7c3aed",
                      borderRadius: 10,
                      color: "#7c3aed",
                      fontWeight: 800,
                      textDecoration: "none",
                      background: "#faf5ff",
                      cursor: studentMovePending ? "progress" : "pointer",
                      userSelect: "none",
                      minHeight: 44,
                      opacity: studentMovePending ? 0.75 : 1,
                    }}
                  >
                    {studentMovePending ? "학생 화면으로 이동 중..." : "학생 화면으로 이동"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onClickLogout}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 20px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 10,
                    background: "var(--home-card-bg)",
                    fontWeight: 700,
                    cursor: "pointer",
                    userSelect: "none",
                    minHeight: 44,
                  }}
                >
                  로그아웃
                </button>
              </div>

              {isProviderTokenExpired(session) && !roleLoading && canAccessRole(role, "teacher") && (
                <div
                  style={{
                    marginTop: 16,
                    borderRadius: 12,
                    border: "1px solid #fca5a5",
                    background: "#fef2f2",
                    color: "#991b1b",
                    padding: "12px 14px",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  ⚠️ <b>구글 캘린더 연결 열쇠가 만료되었습니다.</b><br/>
                  <button
                    type="button"
                    onClick={onClickReconnectGoogleAuth}
                    style={{
                      marginTop: 8,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: "1px solid #be123c",
                      background: "#be123c",
                      color: "#fff",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    구글 권한 다시 연결
                  </button>
                </div>
              )}
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

        {/* 정책 연결 푸터 (Google 심사 필수 요건) */}
        <div style={{ marginTop: 24, textAlign: "center", borderTop: "1px solid var(--surface-border)", paddingTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, fontSize: 12, color: "var(--text-muted)" }}>
            <span
              role="button"
              onClick={onClickTesterLogin}
              style={{ cursor: "pointer" }}
            >
              테스터 로그인
            </span>
            <span style={{ color: "var(--surface-border)" }}>|</span>
            <Link
              href="/policy"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--text-muted)", textDecoration: "none" }}
            >
              이용약관 및 개인정보처리방침
            </Link>
          </div>
        </div>
      </section>
      {autoReauthRequested ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            background: "rgba(15, 23, 42, 0.45)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          aria-live="polite"
          aria-busy="true"
        >
          <section
            style={{
              width: "100%",
              maxWidth: 520,
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "#fff",
              padding: 18,
              boxShadow: "0 16px 40px rgba(15, 23, 42, 0.28)",
              textAlign: "center",
            }}
          >
            <h2 style={{ fontSize: 20, fontWeight: 900, color: "#0f172a" }}>
              재로그인을 위해 홈으로 이동했습니다.
            </h2>
            <p style={{ marginTop: 10, color: "#334155", fontWeight: 700 }}>
              잠시만 기다려 주세요.
            </p>
            <p style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
              자동으로 Google 로그인 화면으로 이동 중입니다.
            </p>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" role="img" aria-label="Google logo">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.55-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.38 3.61v3h3.85c2.25-2.07 3.58-5.12 3.58-8.64z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.89l-3.85-3c-1.07.72-2.44 1.15-4.09 1.15-3.15 0-5.82-2.13-6.77-4.99H1.26v3.13A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.23 14.27a7.2 7.2 0 0 1 0-4.54V6.6H1.26a12 12 0 0 0 0 10.8l3.97-3.13z"
      />
      <path
        fill="#EA4335"
        d="M12 4.74c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.2 15.24 0 12 0A12 12 0 0 0 1.26 6.6l3.97 3.13c.95-2.86 3.62-4.99 6.77-4.99z"
      />
    </svg>
  );
}
