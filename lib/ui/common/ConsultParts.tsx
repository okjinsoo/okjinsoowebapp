"use client";

import Badge from "@/lib/ui/common/Badge";
import type { ConsultTag } from "@/lib/ui/session/consultationMap";

export function consultButtonClass(tag?: ConsultTag | null) {
  if (!tag) return "btn btn-white";
  if (tag.purpose === "general") return "btn btn-gray";
  return tag.buttonClassName;
}

export function ConsultBadge({ tag }: { tag?: ConsultTag | null }) {
  if (!tag) return null;
  return <Badge className={tag.badgeClassName}>{tag.label}</Badge>;
}

export function ConsultButton({
  tag,
  onClick,
  children = "상담",
  className = "",
}: {
  tag?: ConsultTag | null;
  onClick: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      className={`${consultButtonClass(tag)} ${className}`.trim()}
      onClick={onClick}
      style={{ display: "inline-flex", width: "fit-content", whiteSpace: "nowrap" }}
    >
      {children}
    </button>
  );
}
