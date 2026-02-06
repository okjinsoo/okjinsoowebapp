"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

function targetByPath(pathname: string): string {
  if (pathname.startsWith("/a/")) return "/a/amain";
  if (pathname.startsWith("/t/")) return "/t/tmain";
  if (pathname.startsWith("/s/")) return "/s/smain";
  return "/";
}

export default function BrandHomeButton() {
  const router = useRouter();
  const pathname = usePathname();
  const target = useMemo(() => targetByPath(pathname || "/"), [pathname]);

  return (
    <button
      className="brand-home-btn"
      type="button"
      onClick={() => router.push(target)}
      style={{ cursor: "pointer" }}
      aria-label="옥진수학 홈으로 이동"
      title="홈으로 이동"
    >
      옥진수학
    </button>
  );
}
