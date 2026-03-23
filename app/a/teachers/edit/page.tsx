"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AdminTeacherEditLegacyPage() {
  const router = useRouter();

  useEffect(() => {
    const id = setTimeout(() => {
      router.replace("/a/teachers");
    }, 0);
    return () => clearTimeout(id);
  }, [router]);

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
        선생님 정보 수정
      </div>
      <div style={{ marginTop: 10, color: "var(--text-muted)", textAlign: "center" }}>
        선생님 목록으로 이동 중입니다...
      </div>
    </main>
  );
}
