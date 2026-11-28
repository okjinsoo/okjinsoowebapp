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
  titleColumnWidth = 220,
}: Props) {
  const leadColumnWidth = Number.isFinite(titleColumnWidth) && titleColumnWidth > 0 ? `${titleColumnWidth}px` : "220px";

  // 왼쪽: D-day · 회차 · 과제 제출률 · 출결 / 오른쪽: 날짜 · 변경·이월 뱃지
  const content = (
    <>
      {titleSlot ? (
        <>{titleSlot}</>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          {model.dday && model.dday.diff !== null ? (
            <Badge className={`text-white ${model.dday.className}`}>{model.dday.label}</Badge>
          ) : null}
          <span style={{ fontWeight: 700 }}>{model.title}</span>
          <AchievementBadge submission={model.submission} />
          <Badge style={model.statusBadge.style}>{model.statusBadge.label}</Badge>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>{model.dateTimeText}</div>
        {model.extraBadges.map((badge) => (
          <Badge key={`${model.index}:${badge.label}`} style={badge.style}>
            {badge.label}
          </Badge>
        ))}
        {inlineBadgeSlot}
      </div>
    </>
  );

  return (
    <div
      className="session-row"
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
          className="session-row-main"
          style={{
            display: "grid",
            gridTemplateColumns: `${leadColumnWidth} 1fr`,
            gap: 20,
            alignItems: "center",
            cursor: "pointer",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          {content}
        </Link>
      ) : (
        <div
          onClick={() => onClick?.()}
          className="session-row-main"
          style={{
            display: "grid",
            gridTemplateColumns: `${leadColumnWidth} 1fr`,
            gap: 20,
            alignItems: "center",
            cursor: onClick ? "pointer" : "default",
          }}
        >
          {content}
        </div>
      )}
      {rightSlot ? (
        <div
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          className="session-row-actions"
          style={{ display: "flex", gap: 6 }}
        >
          {rightSlot}
        </div>
      ) : null}
    </div>
  );
}
