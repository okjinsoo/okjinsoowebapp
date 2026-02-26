"use client";

import { useRouter } from "next/navigation";

export default function BackToSessionList({
  listHref,
  hubHref,
  listLabel = "← 목록으로 돌아가기",
  hubLabel = "← 학생 페이지",
}: {
  listHref: string;
  hubHref?: string;
  listLabel?: string;
  hubLabel?: string;
}) {
  const router = useRouter();

  return (
    <div style={{ marginTop: 8, marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
      {hubHref ? (
        <button
          onClick={() => router.push(hubHref)}
          style={{
            border: "1px solid #ddd",
            background: "var(--surface-bg)",
            borderRadius: 10,
            padding: "8px 10px",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {hubLabel}
        </button>
      ) : null}

      <button
        onClick={() => router.push(listHref)}
        style={{
          border: "1px solid #ddd",
          background: "var(--surface-bg)",
          borderRadius: 10,
          padding: "8px 10px",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {listLabel}
      </button>
    </div>
  );
}
