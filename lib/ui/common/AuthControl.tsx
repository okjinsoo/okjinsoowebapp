"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AUTH_EVENT, clearAuthSession, loadAuthSession } from "@/lib/auth/supabaseAuth";

export default function AuthControl() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const sync = () => {
      const sess = loadAuthSession();
      setIsLoggedIn(Boolean(sess));
    };
    sync();
    window.addEventListener(AUTH_EVENT, sync);
    return () => window.removeEventListener(AUTH_EVENT, sync);
  }, []);

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/bridge", {
        method: "DELETE",
        credentials: "same-origin",
      });
    } catch {
      // 네트워크 실패 시에도 로컬 세션은 즉시 제거합니다.
    }
    clearAuthSession();
    window.location.replace("/");
  };

  const handleLogin = () => {
    router.push("/");
  };

  if (isLoggedIn) {
    return (
      <button 
        onClick={handleLogout}
        className="btn btn-white"
        style={{ fontSize: "11px", padding: "4px 8px" }}
      >
        로그아웃
      </button>
    );
  }

  return (
    <button 
      onClick={handleLogin}
      className="btn btn-blue"
      style={{ fontSize: "12px", padding: "4px 10px" }}
    >
      로그인
    </button>
  );
}
