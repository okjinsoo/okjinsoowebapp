import { describe, expect, test } from "vitest";

import { isGoogleDriveAuthExpiredErrorMessage } from "@/lib/integrations/googleDriveSync";

describe("isGoogleDriveAuthExpiredErrorMessage", () => {
  test("전용 401 prefix 메시지는 권한 종료로 인식한다", () => {
    expect(
      isGoogleDriveAuthExpiredErrorMessage(
        "[GOOGLE_DRIVE_AUTH_401] 401 구글 드라이브 권한이 종료되었습니다. 사유: Invalid Credentials."
      )
    ).toBe(true);
  });

  test("구글 권한 종료 한글 메시지는 권한 종료로 인식한다", () => {
    expect(
      isGoogleDriveAuthExpiredErrorMessage("구글 권한이 종료되었어요. 재인증을 위해 로그아웃 후 다시 로그인해 주세요.")
    ).toBe(true);
  });

  test("구글 표준 invalid credentials 오류는 권한 종료로 인식한다", () => {
    expect(isGoogleDriveAuthExpiredErrorMessage("401 Invalid Credentials")).toBe(true);
  });

  test("일반 서버 오류는 권한 종료로 오탐하지 않는다", () => {
    expect(isGoogleDriveAuthExpiredErrorMessage("500 Internal Server Error")).toBe(false);
  });

  test("빈 메시지는 권한 종료로 보지 않는다", () => {
    expect(isGoogleDriveAuthExpiredErrorMessage("")).toBe(false);
  });
});
