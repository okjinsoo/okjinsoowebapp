"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--background)",
          color: "var(--foreground)",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div
          style={{
            width: "min(92vw, 460px)",
            border: "1px solid var(--surface-border)",
            borderRadius: 12,
            padding: 20,
            background: "var(--surface-bg)",
          }}
        >
          <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>오류가 발생했습니다.</h2>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            문제가 반복되면 관리자에게 알려주세요. 오류 정보는 자동으로 기록됩니다.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 14,
              border: "1px solid var(--control-border)",
              borderRadius: 8,
              padding: "8px 12px",
              background: "var(--surface-bg)",
              color: "var(--foreground)",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
