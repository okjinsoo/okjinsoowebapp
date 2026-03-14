"use client";

import Badge from "./Badge";
import { getAchievementBadgeStyle } from "./achievementBadgeStyle";

type Props = {
  percent: number | null;
  className?: string;
};

/**
 * 성취도 배지 공용 부품
 * - percent가 null이면 '미정' 표시
 * - percent가 숫자면 'n%' 표시 및 점수대별 색상 적용
 */
export default function AchievementBadge({ percent, className }: Props) {
  if (percent === null) {
    return (
      <Badge
        className={className}
        style={{ background: "#94a3b8", color: "#ffffff" }}
      >
        미정
      </Badge>
    );
  }

  const style = getAchievementBadgeStyle(percent);
  return (
    <Badge className={className} style={style}>
      {percent}%
    </Badge>
  );
}
