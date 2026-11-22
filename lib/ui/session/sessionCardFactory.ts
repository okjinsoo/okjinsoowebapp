import type { SessionState } from "@/lib/factories/sessionFactories";
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
  achievementPercent: number | null;
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
  status: SessionState | undefined;
  achievementPercent: number | null;
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
    achievementPercent: args.achievementPercent,
    statusBadge: getSessionStatusBadge(args.status),
    extraBadges,
  };
}
