import type { SessionMetaStatus } from "@/lib/types/index";
import type { SubmissionSummary } from "@/lib/ui/common/achievementBadgeStyle";
import { getSessionExtraBadgeStyle } from "@/lib/ui/common/sessionExtraBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";

export type SessionCardDday = {
  diff: number | null;
  label: string;
  className: string;
} | null;

export type SessionCardBadgeView = {
  label: string;
  style: { background: string; color: string };
};

export type SessionCardViewModel = {
  index: number;
  title: string;
  dateTimeText: string;
  dday: SessionCardDday;
  submission: SubmissionSummary | null;
  statusBadge: {
    label: "출석" | "결석" | "예정";
    style: { background: string; color: string };
  };
  extraBadges: SessionCardBadgeView[];
};

type BuildSessionCardViewArgs = {
  index: number;
  dateTimeText: string;
  dday: SessionCardDday;
  status: SessionMetaStatus | undefined;
  submission: SubmissionSummary | null;
  extraBadges?: string[];
  hiddenBadgeLabels?: string[];
};

export function buildSessionCardViewModel(args: BuildSessionCardViewArgs): SessionCardViewModel {
  const hidden = new Set(args.hiddenBadgeLabels ?? []);
  const extraBadges = (args.extraBadges ?? [])
    .filter((label) => !hidden.has(label))
    .map((label) => ({
      label,
      style: getSessionExtraBadgeStyle(label),
    }));
  return {
    index: args.index,
    title: `${args.index}회차`,
    dateTimeText: args.dateTimeText,
    dday: args.dday,
    submission: args.submission,
    statusBadge: getSessionStatusBadge(args.status),
    extraBadges,
  };
}
