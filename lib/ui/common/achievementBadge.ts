export type AchievementBadgeStyle = {
  background: string;
  color: string;
};

const BADGE_TEXT = "#ffffff";

export function getAchievementBadgeStyle(percent: number): AchievementBadgeStyle {
  const score = Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;

  if (score <= 50) {
    return { background: "#dc2626", color: BADGE_TEXT };
  }
  if (score <= 77) {
    return { background: "#ea580c", color: BADGE_TEXT };
  }
  if (score <= 90) {
    return { background: "#2563eb", color: BADGE_TEXT };
  }
  return { background: "#16a34a", color: BADGE_TEXT };
}
