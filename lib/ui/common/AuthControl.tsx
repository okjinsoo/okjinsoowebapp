"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AUTH_EVENT, clearAuthSession, loadAuthSession } from "@/lib/auth/supabaseAuth";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";

export default function AuthControl() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [backupStatus, setBackupStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

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

  const handleManualBackup = async () => {
    if (backupStatus === "loading") return;
    setBackupStatus("loading");
    try {
      const dateStr = new Date().toISOString().replace(/[:.]/g, "-");
      const backupId = `pre-deploy-${dateStr}`;
      await pushSharedSnapshot({ manualBackupId: backupId });
      setBackupStatus("done");
      alert(`배포 전 안전 백업 성공! (ID: ${backupId})\n이제 안심하고 모든 탭을 닫으셔도 됩니다.`);
    } catch (err) {
      console.error(err);
      setBackupStatus("error");
      alert("백업 중 오류가 발생했습니다. 다시 시도해 주세요.");
    }
  };

  if (isLoggedIn) {
    return (
      <div className="flex items-center gap-2">
        <button 
          onClick={handleManualBackup}
          className={`btn ${backupStatus === "done" ? "btn-green" : "btn-blue"}`}
          style={{ fontSize: "11px", padding: "4px 8px" }}
          disabled={backupStatus === "loading"}
        >
          {backupStatus === "loading" ? "백업 중..." : backupStatus === "done" ? "✅ 백업완료" : "💾 수동백업"}
        </button>
        <button 
          onClick={handleLogout}
          className="btn btn-white"
          style={{ fontSize: "11px", padding: "4px 8px" }}
        >
          로그아웃
        </button>
      </div>
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
