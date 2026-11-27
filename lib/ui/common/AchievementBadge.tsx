"use client";

import Badge from "./Badge";
import { getSubmissionBadge, type SubmissionSummary } from "./achievementBadgeStyle";

type Props = {
  submission: SubmissionSummary | null;
  isPast: boolean;
  className?: string;
};

/** 회차 제출 배지 공용 부품 ('75%' / '미정' / '공지') */
export default function AchievementBadge({ submission, isPast, className }: Props) {
  const { label, style } = getSubmissionBadge(submission, isPast);
  return (
    <Badge className={className} style={style}>
      {label}
    </Badge>
  );
}
