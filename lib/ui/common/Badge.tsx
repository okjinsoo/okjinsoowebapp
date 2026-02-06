// v1/lib/ui/common/Badge.tsx
"use client";

import React from "react";

export type BadgeTone = "gray" | "blue" | "green" | "orange" | "red";

const TONE_STYLE: Record<BadgeTone, React.CSSProperties> = {
  gray: { background: "#6b7280", color: "#ffffff" },
  blue: { background: "#2563eb", color: "#ffffff" },
  green: { background: "#16a34a", color: "#ffffff" },
  orange: { background: "#f97316", color: "#ffffff" },
  red: { background: "#dc2626", color: "#ffffff" },
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
