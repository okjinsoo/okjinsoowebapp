export const SHARED_CONSULTATIONS_KEY = "tutorweb_consultations_v1";
export const SHARED_LECTURE_TREE_KEY = "mk3:lectureTree";
export const SHARED_DRIVE_ROOT_ID_KEY = "mk3:driveRootId";
export const SHARED_META_MAP_PREFIX = "tutorweb_metaMap_v1:";

const SESSION_PROGRESS_KEY_PATTERN = /^mk3:[^:]+:session:\d+:(leafIds|progressByLeafId|lastAddedLeafId)$/;

export function buildSessionStorageBaseKey(token: string, sessionIndex: number): string {
  return `mk3:${token}:session:${sessionIndex}`;
}

export function sessionLeafIdsKey(token: string, sessionIndex: number): string {
  return `${buildSessionStorageBaseKey(token, sessionIndex)}:leafIds`;
}

export function sessionProgressByLeafIdKey(token: string, sessionIndex: number): string {
  return `${buildSessionStorageBaseKey(token, sessionIndex)}:progressByLeafId`;
}

export function isSessionProgressStateKey(key: string): boolean {
  if (!key) return false;
  return SESSION_PROGRESS_KEY_PATTERN.test(key);
}

export function isSharedStateKvKey(key: string): boolean {
  if (!key) return false;
  if (key === SHARED_CONSULTATIONS_KEY) return true;
  if (key === SHARED_LECTURE_TREE_KEY) return true;
  if (key === SHARED_DRIVE_ROOT_ID_KEY) return true; // 추가
  if (key.startsWith(SHARED_META_MAP_PREFIX)) return true;
  if (isSessionProgressStateKey(key)) return true;
  return false;
}
