"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import AchievementBadge from "@/lib/ui/common/AchievementBadge";
import Badge from "@/lib/ui/common/Badge";
import type { SessionCardViewModel } from "@/lib/ui/session/sessionCardFactory";

type Props = {
  model: SessionCardViewModel;
  onClick?: () => void;
  href?: string;
  rightSlot?: ReactNode;
  inlineBadgeSlot?: ReactNode;
  titleSlot?: ReactNode;
  titleColumnWidth?: number;
};

export default function SessionCardRow({
  model,
  onClick,
  href,
  rightSlot,
  inlineBadgeSlot,
  titleSlot,
  titleColumnWidth = 110,
}: Props) {
  const leadColumnWidth = Number.isFinite(titleColumnWidth) && titleColumnWidth > 0 ? `${titleColumnWidth}px` : "110px";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "8px 10px",
        border: "1px solid var(--surface-border)",
        borderRadius: 8,
        background: "var(--surface-bg)",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
    >
      {href ? (
        <Link
          href={href}
          onClick={() => onClick?.()}
          style={{
            display: "grid",
            gridTemplateColumns: `${leadColumnWidth} 1fr`,
            gap: 30,
            alignItems: "center",
            cursor: "pointer",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {titleSlot ? (
            <>{titleSlot}</>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
              {model.dday && model.dday.diff !== null ? (
                <Badge className={`text-white ${model.dday.className}`}>{model.dday.label}</Badge>
              ) : null}
              <span>{model.title}</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>{model.dateTimeText}</div>
            <AchievementBadge percent={model.achievementPercent} />
            <Badge style={model.statusBadge.style}>{model.statusBadge.label}</Badge>
            {model.extraBadges.map((badge) => (
              <Badge key={`${model.index}:${badge.label}`} style={badge.style}>
                {badge.label}
              </Badge>
            ))}
            {inlineBadgeSlot}
          </div>
        </Link>
      ) : (
        <div
          onClick={() => onClick?.()}
          style={{
            display: "grid",
            gridTemplateColumns: `${leadColumnWidth} 1fr`,
            gap: 30,
            alignItems: "center",
            cursor: onClick ? "pointer" : "default",
          }}
        >
          {titleSlot ? (
            <>{titleSlot}</>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
              {model.dday && model.dday.diff !== null ? (
                <Badge className={`text-white ${model.dday.className}`}>{model.dday.label}</Badge>
              ) : null}
              <span>{model.title}</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>{model.dateTimeText}</div>
            <AchievementBadge percent={model.achievementPercent} />
            <Badge style={model.statusBadge.style}>{model.statusBadge.label}</Badge>
            {model.extraBadges.map((badge) => (
              <Badge key={`${model.index}:${badge.label}`} style={badge.style}>
                {badge.label}
              </Badge>
            ))}
            {inlineBadgeSlot}
          </div>
        </div>
      )}
      {rightSlot ? (
        <div
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          style={{ display: "flex", gap: 6 }}
        >
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
