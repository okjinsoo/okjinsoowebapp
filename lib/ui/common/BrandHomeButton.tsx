"use client";

import { useRouter } from "next/navigation";

export default function BrandHomeButton() {
  const router = useRouter();

  return (
    <button
      className="brand-home-btn"
      type="button"
      onClick={() => router.push("/")}
      style={{ cursor: "pointer" }}
      aria-label="옥진수학 홈으로 이동"
      title="홈으로 이동"
    >
      옥진수학
    </button>
  );
}
