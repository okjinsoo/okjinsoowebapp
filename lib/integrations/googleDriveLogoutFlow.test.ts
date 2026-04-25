import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const clearAuthSessionMock = vi.fn();

vi.mock("@/lib/auth/supabaseAuth", () => ({
  clearAuthSession: clearAuthSessionMock,
  loadAuthSession: vi.fn(),
}));

type SessionStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function makeSessionStorage(initial: Record<string, string> = {}): SessionStorageLike {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function installWindow(args: {
  pathname: string;
  search?: string;
  sessionStorage?: SessionStorageLike;
  replaceSpy?: ReturnType<typeof vi.fn>;
}): ReturnType<typeof vi.fn> {
  const replaceSpy = args.replaceSpy ?? vi.fn();
  const sessionStorage = args.sessionStorage ?? makeSessionStorage();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        pathname: args.pathname,
        search: args.search ?? "",
        replace: replaceSpy,
      },
      sessionStorage,
    },
  });
  return replaceSpy;
}

describe("logoutForDriveReauth", () => {
  beforeEach(() => {
    vi.resetModules();
    clearAuthSessionMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("현재 경로를 next로 보존하며 재인증 화면으로 이동한다", async () => {
    const replaceSpy = installWindow({
      pathname: "/s/smain/session/1",
      search: "?from=drive",
    });

    const { logoutForDriveReauth } = await import("@/lib/integrations/googleDriveSync");
    const moved = logoutForDriveReauth();

    expect(moved).toBe(true);
    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("/auth/reauth?next=%2Fs%2Fsmain%2Fsession%2F1%3Ffrom%3Ddrive");
  });

  test("쿨다운 시간 내 중복 자동 로그아웃은 막는다", async () => {
    const now = Date.now();
    const sessionStorage = makeSessionStorage({
      tutorweb_google_drive_auto_logout_ts_v1: String(now),
    });
    const replaceSpy = installWindow({
      pathname: "/s/smain/session/1",
      search: "",
      sessionStorage,
    });

    const { logoutForDriveReauth } = await import("@/lib/integrations/googleDriveSync");
    const moved = logoutForDriveReauth();

    expect(moved).toBe(false);
    expect(clearAuthSessionMock).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  test("강제 모드(force)는 쿨다운을 우회해 즉시 이동한다", async () => {
    const now = Date.now();
    const sessionStorage = makeSessionStorage({
      tutorweb_google_drive_auto_logout_ts_v1: String(now),
    });
    const replaceSpy = installWindow({
      pathname: "/s/smain/session/2",
      search: "",
      sessionStorage,
    });

    const { logoutForDriveReauth } = await import("@/lib/integrations/googleDriveSync");
    const moved = logoutForDriveReauth({ force: true });

    expect(moved).toBe(true);
    expect(clearAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("/auth/reauth?next=%2Fs%2Fsmain%2Fsession%2F2");
  });

  test("auth/callback 경로에서는 자동 로그아웃을 수행하지 않는다", async () => {
    const replaceSpy = installWindow({
      pathname: "/auth/callback",
      search: "?next=%2Fs%2Fsmain",
    });

    const { logoutForDriveReauth } = await import("@/lib/integrations/googleDriveSync");
    const moved = logoutForDriveReauth({ force: true });

    expect(moved).toBe(false);
    expect(clearAuthSessionMock).not.toHaveBeenCalled();
    expect(replaceSpy).not.toHaveBeenCalled();
  });
});
