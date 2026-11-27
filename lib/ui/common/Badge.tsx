// v1/lib/ui/common/Badge.tsx
"use client";

import React from "react";

export type BadgeStyle = React.CSSProperties;
export type BadgeTone = "gray" | "blue" | "green" | "orange" | "red";

const TONE_STYLE: Record<BadgeTone, React.CSSProperties> = {
  gray: { background: "var(--quiet)", color: "#ffffff" },
  blue: { background: "var(--brand)", color: "#ffffff" },
  green: { background: "var(--ok)", color: "#ffffff" },
  orange: { background: "var(--wait)", color: "#ffffff" },
  red: { background: "var(--alert)", color: "#ffffff" },
};

type Props = React.HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export default function Badge({ className, style, children, tone, ...rest }: Props) {
  const mergedStyle = tone ? { ...TONE_STYLE[tone], ...style } : style;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${className ?? ""}`.trim()}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </span>
  );
}
