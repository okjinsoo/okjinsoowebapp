"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TEACHERS_EVENT } from "@/lib/storage/teachers";
import {
  AUTH_EVENT,
  AUTH_STORAGE_KEY,
  clearAuthSession,
  isSessionExpired,
  loadAuthSession,
} from "@/lib/auth/supabaseAuth";
import {
  canAccessRole,
  getUserRole,
  roleLabel,
  type RequiredRole,
  type UserRole,
} from "@/lib/auth/roleAuth";

type Props = {
  requiredRole: RequiredRole;
  children: React.ReactNode;
};

export default function RoleRouteGuard({ requiredRole, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] = useState<"checking" | "allowed" | "blocked">("checking");
  const [role, setRole] = useState<UserRole>("guest");
  const [reason, setReason] = useState<"login" | "role">("login");

  useEffect(() => {
    function sync() {
      const rawSession = loadAuthSession();
      if (rawSession && isSessionExpired(rawSession)) {
        clearAuthSession();
      }

      const session = loadAuthSession();
      const nextRole = getUserRole(session?.email);
      const allowed = canAccessRole(nextRole, requiredRole);

      setRole(nextRole);
      setStatus(allowed ? "allowed" : "blocked");
      setReason(session ? "role" : "login");
    }

    function onStorage(e: StorageEvent) {
      if (
        e.key === null ||
        e.key === AUTH_STORAGE_KEY ||
        e.key === "tutorweb_students_v1" ||
        e.key === "tutorweb_teachers_v1"
      ) {
        sync();
      }
    }

    sync();
    window.addEventListener(AUTH_EVENT, sync);
    window.addEventListener("tutorweb:studentsUpdated", sync);
    window.addEventListener(TEACHERS_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(AUTH_EVENT, sync);
      window.removeEventListener("tutorweb:studentsUpdated", sync);
      window.removeEventListener(TEACHERS_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [requiredRole]);

  useEffect(() => {
    if (status !== "blocked") return;
    const id = window.setTimeout(() => {
      router.replace(`/?next=${encodeURIComponent(pathname || "/")}`);
    }, 700);
    return () => window.clearTimeout(id);
  }, [status, router, pathname]);

  if (status === "allowed") return <>{children}</>;

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
          maxWidth: 540,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          background: "#fff",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 900 }}>
          {status === "checking" ? "권한 확인 중..." : "접근 제한"}
        </h1>
        <p style={{ marginTop: 8, color: "#475569", lineHeight: 1.6 }}>
          {status === "checking"
            ? "로그인 상태를 확인하고 있어요."
            : reason === "login"
              ? "로그인이 필요해서 홈으로 이동합니다."
              : `현재 계정(${roleLabel(role)})으로는 이 화면에 접근할 수 없어서 홈으로 이동합니다.`}
        </p>
      </section>
    </main>
  );
}
