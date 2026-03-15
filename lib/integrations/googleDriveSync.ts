"use client";

import { loadAuthSession } from "@/lib/auth/supabaseAuth";

const GOOGLE_DRIVE_BASE_URL = "https://www.googleapis.com/drive/v3";
const GOOGLE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3";

export type DriveFile = {
  id: string;
  name: string;
  webViewLink?: string;
  mimeType: string;
};

/**
 * 구글 API 요청을 위한 공용 래퍼
 */
export async function requestDrive(args: {
  token: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  isUpload?: boolean;
  contentType?: string;
  _retry?: boolean;
}): Promise<unknown> {
  const baseUrl = args.isUpload ? GOOGLE_UPLOAD_BASE_URL : GOOGLE_DRIVE_BASE_URL;
  const url = new URL(`${baseUrl}${args.path}`);
  if (args.query) {
    for (const [k, v] of Object.entries(args.query)) {
      url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${args.token}`,
  };

  if (args.contentType) {
    headers["Content-Type"] = args.contentType;
  } else if (args.body && !(args.body instanceof FormData) && !(args.body instanceof Blob)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url.toString(), {
    method: args.method,
    headers,
    body: args.body === undefined || args.method === "GET" 
      ? undefined 
      : (args.body instanceof FormData || args.body instanceof Blob ? args.body : JSON.stringify(args.body)),
  });

  if (res.status === 204) return null;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    const errorData = body as any;
    const message = errorData?.error?.message || "Google Drive API 오류";
    
  // 401 발생 시 토큰 만료 재시도 (googleCalendarSync와 동일 로직)
    if (res.status === 401 && !args._retry) {
      // [보안] 게스트 계정(미등록 사용자)은 드라이브 리커버리를 시도하지 않음
      const { resolveUserRole } = await import("@/lib/auth/roleAuth");
      const auth = loadAuthSession();
      const userRole = await resolveUserRole({ email: auth?.email, accessToken: auth?.accessToken });
      if (userRole === "guest") {
        console.warn(`[Drive API] 게스트 계정은 자동 갱신 권한이 없습니다.`);
        throw new Error("미등록 계정은 이 기능을 사용할 수 없습니다. 원장님께 등록을 요청해 주세요.");
      }

      console.warn(`[Drive API] 401 감지됨. 세션 갱신 시도 중...`);
      try {
        const { forceRefreshAuthSession, loadAuthSession } = await import("@/lib/auth/supabaseAuth");
        const current = loadAuthSession();
        if (current?.providerAccessToken && current.providerAccessToken !== args.token) {
          console.log("[Drive API] 이미 토큰이 갱신되어 있습니다. 새 토큰으로 재시도합니다.");
          return requestDrive({ ...args, token: current.providerAccessToken, _retry: true });
        }

        const nextSession = await forceRefreshAuthSession();
        const nextToken = nextSession?.providerAccessToken;
        if (nextToken && nextToken !== args.token) {
          console.log("[Drive API] 토큰 갱신 성공. 새 토큰으로 재시도합니다.");
          return requestDrive({ ...args, token: nextToken, _retry: true });
        }
        console.warn("[Drive API] 토큰 자동 갱신으로도 해결되지 않았습니다.");
      } catch (err) {
        console.error("[Drive API Recovery Failed]", err);
      }
    }
    
    if (res.status === 401) {
      // 재로그인 유도를 위해 전역 이벤트를 발생시킵니다.
      if (typeof window !== "undefined") {
        try {
          const { TUTORWEB_EVENTS } = await import("@/lib/events/tutorwebEvents");
          window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.googleAuthError, { detail: { msg: message } }));
        } catch (err) {
          console.error("Failed to dispatch auth error event", err);
        }
      }
      throw new Error(`구글 권한이 만료되었습니다. '구글 권한 다시 연결' 버튼을 클릭하거나 다시 로그인해 주세요. (사유: ${message})`);
    }
  }

  return body;
}

/**
 * 특정 상위 폴더 내에서 이름으로 폴더를 찾거나 생성합니다.
 */
export async function ensureFolder(args: {
  token: string;
  name: string;
  parentId?: string;
}): Promise<string> {
  const { token, name, parentId } = args;

  // 1. 해당 폴더 검색
  // parentId가 있으면 해당 부모 밑에서만 찾도록 쿼리 강화
  let q = `name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  }

  const searchResult = await requestDrive({
    token,
    method: "GET",
    path: "/files",
    query: {
      q,
      fields: "files(id, name, parents)",
      spaces: "drive",
    },
  }) as { files: { id: string, parents?: string[] }[] };

  // 1-1. 검색 결과가 있으면 바로 반환 (쿼리에서 이미 부모 조건을 걸었으므로 신뢰할 수 있음)
  if (searchResult.files && searchResult.files.length > 0) {
    return searchResult.files[0].id;
  }

  // 2. 없거나 부모가 다르면 생성
  try {
    const createResult = await requestDrive({
      token,
      method: "POST",
      path: "/files",
      body: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
      },
    }) as { id: string };

    return createResult.id;
  } catch (err) {
    if (err instanceof Error && err.message.includes("404")) {
      throw new Error(`부모 폴더(${parentId})를 찾을 수 없습니다. 관리자 페이지에서 '본진 드라이브 입지 선정'을 다시 수행해 주세요.`);
    }
    throw err;
  }
}

/**
 * 원장님이 지정한 정밀 계층 구조를 보장하며 최종 업로드 폴더 ID를 반환합니다.
 * 경로: 01_옥진수학 -> 01_Students -> 기수_이름 -> 03_숙제 제출 -> n회차 -> 강의제목 -> 제출종류
 * @param startRootId 시스템에 고정된 01_Students 폴더의 ID (있는 경우)
 */
export async function ensurePath(args: {
  token: string;
  sessionIndex: number;
  contentTitle: string; 
  submitType: "필기 제출" | "풀이 제출";
  startStudentFolderId: string; // 필수: 학생 전용 사물함 ID
}): Promise<string> {
  const { token, submitType, sessionIndex, contentTitle, startStudentFolderId } = args;

  if (!startStudentFolderId) {
    throw new Error("원장님이 사물함을 아직 배정하지 않았습니다. 관리자에게 [학생 사물함 일괄 정비]를 요청해 주세요.");
  }

  // 1. 이미 배정된 학생 전용 사물함 ID를 바로 사용 (보안 및 성능 최적화)
  const studentFolderId = startStudentFolderId;

  // 2. 숙제 제출 폴더 (이미 만들어진 학생 폴더 내부에서 진행)
  const homeworkRootId = await ensureFolder({ token, name: "03_숙제 제출", parentId: studentFolderId });

  // 5. 회차 폴더: n회차
  const sessionFolderName = `${sessionIndex}회차`;
  const sessionFolderId = await ensureFolder({ token, name: sessionFolderName, parentId: homeworkRootId });

  // 6. 강의/문제 제목 폴더
  const contentFolderId = await ensureFolder({ token, name: contentTitle, parentId: sessionFolderId });

  // 7. 최종 제출 종류 폴더 (필기/풀이)
  return await ensureFolder({ token, name: submitType, parentId: contentFolderId });
}

/**
 * 파일을 업로드합니다.
 */
export async function uploadToDrive(args: {
  token: string;
  folderId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<DriveFile> {
  const { token, folderId, file } = args;

  // 메타데이터 생성
  const metadata = {
    name: file.name,
    parents: [folderId],
  };

  // Multipart 업로드 (간단한 파일용)
  // 부하 방지를 위해 5MB 이상은 나중에 Resumable 고려 가능하지만 사진은 대개 이보다 작음
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const result = await requestDrive({
    token,
    method: "POST",
    path: "/files",
    query: { uploadType: "multipart", fields: "id, name, webViewLink, mimeType" },
    body: form,
    isUpload: true,
  }) as DriveFile;

  return result;
}

/**
 * 특정 이메일 사용자에게 폴더/파일의 편집(writer) 권한을 부여합니다.
 */
export async function shareFolderWithEmail(args: {
  token: string;
  fileId: string;
  email: string;
}): Promise<void> {
  const { token, fileId, email } = args;
  
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      role: "writer",
      type: "user",
      emailAddress: email.trim().toLowerCase(),
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error("폴더 공유 실패:", errorData);
    throw new Error(`폴더 공유 실패: ${res.status} ${JSON.stringify(errorData)}`);
  }
}

/**
 * 폴더 내 파일 목록을 조회합니다. (스테이징 UI용)
 */
export async function listFiles(args: {
  token: string;
  folderId: string;
}): Promise<DriveFile[]> {
  const result = await requestDrive({
    token: args.token,
    method: "GET",
    path: "/files",
    query: {
      q: `'${args.folderId}' in parents and trashed = false`,
      fields: "files(id, name, webViewLink, mimeType)",
      orderBy: "createdTime desc",
    },
  }) as { files: DriveFile[] };

  return result.files || [];
}

/**
 * 파일을 삭제합니다.
 */
export async function deleteFileFromDrive(args: {
  token: string;
  fileId: string;
}): Promise<void> {
  await requestDrive({
    token: args.token,
    method: "DELETE",
    path: `/files/${args.fileId}`,
  });
}
