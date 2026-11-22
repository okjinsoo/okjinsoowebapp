import {
  isSessionProgressStateKey,
  isSharedStateKvKey,
  SHARED_META_MAP_PREFIX,
} from "@/lib/shared/sharedStateKeys";

export function filterStateKvForViewer(
  stateKv: Record<string, string>,
  viewer: {
    role: string;
    studentId: string | null;
    studentToken?: string | null;
    teacherStudentTokens?: Set<string>;
  }
): Record<string, string> {
  const out: Record<string, string> = {};
  const isStudent = viewer.role === "student" && Boolean(viewer.studentToken);
  const studentTokenPrefix = isStudent ? `mk3:${viewer.studentToken}:` : "";
  const studentMetaKey = isStudent ? `${SHARED_META_MAP_PREFIX}${viewer.studentToken}` : "";
  const isTeacher = viewer.role === "teacher" && Boolean(viewer.teacherStudentTokens);
  const teacherTokens = viewer.teacherStudentTokens;

  for (const [k, v] of Object.entries(stateKv)) {
    if (!isSharedStateKvKey(k)) continue; // [다이어트 핵심] mk3:backup: 등 백업 키 및 불필요한 키 전송 차단

    if (isStudent) {
      // 학생 계정이면 본인 데이터만 선별
      if (k.startsWith(SHARED_META_MAP_PREFIX) && k !== studentMetaKey) continue;
      if (k.startsWith("mk3:") && !k.startsWith("mk3:lectureTree") && !k.startsWith("mk3:driveRootId")) {
        if (!k.startsWith(studentTokenPrefix)) continue;
      }
    } else if (isTeacher && teacherTokens) {
      // [선택지 B 다이어트] 선생님 계정이면 본인 담당 학생들의 메타맵 및 진도 키만 선별 (전역 강의 트리/드라이브 루트는 유지)
      if (k.startsWith(SHARED_META_MAP_PREFIX)) {
        const token = k.slice(SHARED_META_MAP_PREFIX.length);
        if (!teacherTokens.has(token)) continue;
      } else if (k.startsWith("mk3:") && !k.startsWith("mk3:lectureTree") && !k.startsWith("mk3:driveRootId")) {
        const secondColon = k.indexOf(":", 4);
        const token = secondColon > 4 ? k.slice(4, secondColon) : "";
        if (!teacherTokens.has(token)) continue;
      }
    }

    out[k] = v;
  }
  return out;
}

export function isTeacherAllowedStateKvKey(key: string, myStudentTokens: Set<string>): boolean {
  if (!key || !isSharedStateKvKey(key)) return false;
  if (key === "mk3:lectureTree" || key === "mk3:driveRootId") return true;
  if (key.startsWith(SHARED_META_MAP_PREFIX)) {
    const token = key.slice(SHARED_META_MAP_PREFIX.length);
    return myStudentTokens.has(token);
  }
  if (key.startsWith("mk3:") && isSessionProgressStateKey(key)) {
    const secondColon = key.indexOf(":", 4);
    const token = secondColon > 4 ? key.slice(4, secondColon) : "";
    return myStudentTokens.has(token);
  }
  return false;
}

