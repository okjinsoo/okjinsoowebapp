export type TutorRole = "a" | "t" | "s";

type ManagerRole = "a" | "t";

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function normalizeSessionIndex(index: number): number {
  if (!Number.isFinite(index)) return 1;
  return Math.max(1, Math.floor(index));
}

export function buildSmainBasePath(role: TutorRole): string {
  return `/${role}/smain`;
}

export function buildSmainEditPath(role: TutorRole): string {
  return `${buildSmainBasePath(role)}/edit`;
}

export function buildSmainSessionListPath(role: TutorRole): string {
  return `${buildSmainBasePath(role)}/session`;
}

export function buildSmainSessionDetailPath(args: { role: TutorRole; sessionIndex: number }): string {
  return `${buildSmainSessionListPath(args.role)}/${normalizeSessionIndex(args.sessionIndex)}`;
}

export function buildSmainSessionDetailPathWithToken(args: {
  role: TutorRole;
  sessionIndex: number;
  studentToken: string;
}): string {
  return `${buildSmainSessionDetailPath(args)}?token=${encodePathSegment(args.studentToken)}`;
}

export function buildTmainBasePath(role: ManagerRole): string {
  return `/${role}/tmain`;
}

export function buildTmainNewPath(role: ManagerRole): string {
  return `${buildTmainBasePath(role)}/new`;
}

export function buildTeacherStudentHubPath(args: { role: "t"; studentToken: string }): string {
  return `${buildTmainBasePath(args.role)}/${encodePathSegment(args.studentToken)}`;
}

export function buildTeacherStudentEditPath(args: { role: "t"; studentToken: string }): string {
  return `${buildTeacherStudentHubPath(args)}/edit`;
}

export function buildTeacherStudentSessionListPath(args: { role: "t"; studentToken: string }): string {
  return `${buildTeacherStudentHubPath(args)}/session`;
}

export function buildTeacherStudentSessionDetailPath(args: {
  role: "t";
  studentToken: string;
  sessionIndex: number;
}): string {
  return `${buildTeacherStudentSessionListPath(args)}/${normalizeSessionIndex(args.sessionIndex)}`;
}

export function buildAdminTeacherTmainPath(teacherToken: string): string {
  return `${buildTmainBasePath("a")}/${encodePathSegment(teacherToken)}`;
}

export function buildAdminTeacherStudentPrefixPath(teacherToken: string): string {
  return `${buildAdminTeacherTmainPath(teacherToken)}/smain`;
}

export function buildAdminTeacherStudentHubPath(args: {
  teacherToken: string;
  studentToken: string;
}): string {
  return `${buildAdminTeacherStudentPrefixPath(args.teacherToken)}/${encodePathSegment(args.studentToken)}`;
}

export function buildAdminTeacherStudentEditPath(args: {
  teacherToken: string;
  studentToken: string;
}): string {
  return `${buildAdminTeacherStudentHubPath(args)}/edit`;
}

export function buildAdminTeacherStudentSessionListPath(args: {
  teacherToken: string;
  studentToken: string;
}): string {
  return `${buildAdminTeacherStudentHubPath(args)}/session`;
}

export function buildAdminTeacherStudentSessionDetailPath(args: {
  teacherToken: string;
  studentToken: string;
  sessionIndex: number;
}): string {
  return `${buildAdminTeacherStudentSessionListPath(args)}/${normalizeSessionIndex(args.sessionIndex)}`;
}
