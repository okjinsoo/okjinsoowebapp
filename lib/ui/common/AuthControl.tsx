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

  const handleLogout = () => {
    clearAuthSession();
    router.push("/");
  };

  const handleLogin = () => {
    router.push("/");
  };

  if (isLoggedIn) {
    return (
      <button 
        onClick={handleLogout}
        className="btn btn-white"
        style={{ fontSize: "12px", padding: "4px 10px" }}
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
