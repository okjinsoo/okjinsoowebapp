import { buildSessionCardViewModel, type SessionCardViewModel } from "@/lib/ui/session/sessionCardFactory";

export type TeacherSessionRow = {
  studentId: string;
  token: string;
  studentName: string;
  index: number;
  effectiveISO: string;
  dateText: string;
  timeText: string;
  status: "planned" | "present" | "absent";
  badges?: string[];
  ddayLabel: string;
  ddayClass: string;
  percent: number | null;
  lastClass?: boolean;
};

export type TeacherSessionCardViewModel = {
  key: string;
  detailHref: string;
  token: string;
  index: number;
  studentName: string;
  roundLabel: string;
  sessionCardModel: SessionCardViewModel;
  showLastClassBadge: boolean;
};

export function buildTeacherSessionCardViewModel(args: {
  row: TeacherSessionRow;
  role: "a" | "t" | "s";
}): TeacherSessionCardViewModel {
  const { row, role } = args;
  const badges = row.badges ?? [];
  const showLastClassBadge = Boolean(row.lastClass || badges.includes("마지막 수업"));
  const sessionCardModel = buildSessionCardViewModel({
    index: row.index,
    dateTimeText: `${row.dateText} ${row.timeText}`.trim(),
    dday: null,
    status: row.status,
    achievementPercent: row.percent,
    extraBadges: badges,
    hiddenBadgeLabels: ["마지막 수업"],
  });
  return {
    key: `today-${row.token}-${row.index}`,
    detailHref: `/${role}/smain/session/${row.index}?token=${encodeURIComponent(row.token)}`,
    token: row.token,
    index: row.index,
    studentName: row.studentName,
    roundLabel: sessionCardModel.title,
    sessionCardModel,
    showLastClassBadge,
  };
}
