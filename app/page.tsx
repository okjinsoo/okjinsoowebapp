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
  type AuthSession,
} from "@/lib/auth/supabaseAuth";
import {
  canAccessRole,
  resolveUserRole,
  roleLabel,
  type UserRole,
} from "@/lib/auth/roleAuth";
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
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const studentAutoRedirectedRef = useRef(false);

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

  useEffect(() => {
    if (!session || roleLoading || !canAccessRole(role, "student")) return;
    void router.prefetch("/s/smain");
  }, [session, roleLoading, role, router]);

  useEffect(() => {
    if (studentAutoRedirectedRef.current) return;
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
  }, [session, roleLoading, role, router, startTransition]);

  const loginReady = useMemo(() => Boolean(getSupabaseConfig()), []);

  function onClickGoogleLogin() {
    setError("");
    if (!loginReady) {
      setError("환경변수가 비어 있어요. .env 설정을 먼저 해주세요.");
      return;
    }

    setBusy(true);
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
    const nextPath = normalizeNextPath(redirectFrom);
    const redirectTo = buildCallbackRedirectUrl({ origin: window.location.origin, nextPath });
    // 관리자/테스터 로그인: 캘린더 권한(requestCalendar) TRUE
    const url = buildGoogleAuthUrl(redirectTo, true);
    if (!url) {
      setBusy(false);
      setError("로그인 URL을 만들지 못했어요.");
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
                  일정 동기화를 위해 반드시 <b>로그아웃 후 다시 로그인</b>해 주세요.
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
