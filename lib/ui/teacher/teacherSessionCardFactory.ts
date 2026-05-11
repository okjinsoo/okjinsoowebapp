import { buildSessionCardViewModel, type SessionCardViewModel } from "@/lib/ui/session/sessionCardFactory";
import {
  buildAdminTeacherStudentSessionDetailPath,
  buildSmainSessionDetailPathWithToken,
  buildTeacherStudentSessionDetailPath,
  buildTmainBasePath,
} from "@/lib/routes/appRouteBuilder";

export type TeacherSessionRow = {
  studentId: string;
  teacherToken?: string;
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
  const detailHref =
    role === "a"
      ? row.teacherToken
        ? buildAdminTeacherStudentSessionDetailPath({
            teacherToken: row.teacherToken,
            studentToken: row.token,
            sessionIndex: row.index,
          })
        : buildTmainBasePath("a")
      : role === "t"
        ? buildTeacherStudentSessionDetailPath({
            role: "t",
            studentToken: row.token,
            sessionIndex: row.index,
          })
        : buildSmainSessionDetailPathWithToken({
            role,
            sessionIndex: row.index,
            studentToken: row.token,
          });
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
    detailHref,
    token: row.token,
    index: row.index,
    studentName: row.studentName,
    roundLabel: sessionCardModel.title,
    sessionCardModel,
    showLastClassBadge,
  };
}
