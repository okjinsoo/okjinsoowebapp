import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { loadLectureTree, parseLectureTreeRaw } from "@/lib/storage/lectures";
import {
  SHARED_DRIVE_ROOT_ID_KEY,
  SHARED_LECTURE_TREE_KEY,
  SHARED_META_MAP_PREFIX,
  sessionProgressByLeafIdKey,
} from "@/lib/shared/sharedStateKeys";

const hoisted = vi.hoisted(() => ({
  forceRefreshAuthSessionMock: vi.fn(),
  loadAuthSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth/supabaseAuth", () => ({
  AUTH_EVENT: "tutorweb:authUpdated",
  AUTH_STORAGE_KEY: "tutorweb_auth_session_v1",
  forceRefreshAuthSession: hoisted.forceRefreshAuthSessionMock,
  isProviderTokenExpired: () => false,
  loadAuthSession: hoisted.loadAuthSessionMock,
}));

import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import {
  decideNextPushRetryDelayMs,
  decidePushFailureAction,
  shouldEnqueueStateKvKeyForClient,
} from "@/lib/ui/common/SharedSnapshotAgent";

const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;

describe("Incoming 트래픽 폭주 방지 및 401/403 안전 처리 회귀 테스트", () => {
  const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchedEvents.length = 0;
    hoisted.loadAuthSessionMock.mockReturnValue({ accessToken: "tok-old", email: "t@test.com" });
    hoisted.forceRefreshAuthSessionMock.mockResolvedValue(null);
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: vi.fn((ev: { type: string; detail?: unknown }) => {
        dispatchedEvents.push({ type: ev.type, detail: ev.detail });
      }),
    };
    browserStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });

  it("parseLectureTreeRaw는 root.createdAt 기존 타임스탬프를 보존해 매번 다른 JSON이 되지 않게 한다", () => {
    const sample = {
      version: 2,
      updatedAt: "2026-10-01T00:00:00.000Z",
      root: {
        type: "folder",
        id: "lecture_root_v2",
        title: "전체 강의",
        createdAt: "2026-01-01T00:00:00.000Z",
        children: [
          {
            type: "folder",
            id: "f1",
            title: "중1",
            createdAt: "2026-01-02T00:00:00.000Z",
            orderKey: "0001",
            children: [],
          },
        ],
      },
    };
    const raw = JSON.stringify(sample);
    const parsed1 = parseLectureTreeRaw(raw);
    const parsed2 = parseLectureTreeRaw(raw);
    expect(parsed1.root.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(JSON.stringify(parsed1)).toBe(JSON.stringify(parsed2));
  });

  it("loadLectureTree는 읽기 시 BROWSER_STORAGE_EVENT(원격 POST 트리거)를 절대 발생시키지 않는다", () => {
    const legacyRaw = JSON.stringify({
      version: 2,
      updatedAt: "2026-10-01T00:00:00.000Z",
      root: {
        type: "folder",
        id: "lecture_root_v2",
        title: "전체 강의",
        children: [
          {
            type: "folder",
            id: "f1",
            title: "중1",
            orderKey: "0001",
            children: [],
          },
        ],
      },
    });
    browserStorage.setItemSilent(SHARED_LECTURE_TREE_KEY, legacyRaw);
    dispatchedEvents.length = 0;

    const tree = loadLectureTree();
    expect(tree.root.children).toHaveLength(1);
    expect(dispatchedEvents.filter((e) => e.type === BROWSER_STORAGE_EVENT)).toHaveLength(0);
  });

  it("pushSharedSnapshot은 403(금지 키)에만 nonRetryable=true를 반환하고, 401(토큰 만료)은 세션 갱신 후 1회 재시도한다", async () => {
    // 1) 403 금지 키 -> 토큰 갱신 없이 즉시 nonRetryable=true
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "forbidden" }),
    }) as unknown as typeof fetch;

    const res403 = await pushSharedSnapshot({
      stateKv: { [SHARED_LECTURE_TREE_KEY]: "{}" },
    });
    expect(res403.stateKvSynced).toBe(false);
    expect(res403.httpStatus).toBe(403);
    expect(res403.nonRetryable).toBe(true);
    expect(hoisted.forceRefreshAuthSessionMock).not.toHaveBeenCalled();

    // 2) 401 토큰 만료 -> forceRefreshAuthSession 성공 시 1회 재시도해 복구
    hoisted.forceRefreshAuthSessionMock.mockResolvedValueOnce({ accessToken: "tok-fresh" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: "unauthorized" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, sessionsSynced: true, stateKvSynced: true }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res401Recovered = await pushSharedSnapshot({
      stateKv: { [sessionProgressByLeafIdKey("tok-a", 1)]: "{}" },
    });
    expect(hoisted.forceRefreshAuthSessionMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res401Recovered.stateKvSynced).toBe(true);

    // 3) 401 토큰 갱신도 실패 -> 편집 유실 방지를 위해 nonRetryable=false(큐 보존/일시정지 가능)
    hoisted.forceRefreshAuthSessionMock.mockResolvedValueOnce(null);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    }) as unknown as typeof fetch;

    const res401Failed = await pushSharedSnapshot({
      stateKv: { [sessionProgressByLeafIdKey("tok-a", 1)]: "{}" },
    });
    expect(res401Failed.stateKvSynced).toBe(false);
    expect(res401Failed.httpStatus).toBe(401);
    expect(res401Failed.nonRetryable).toBe(false);
  });

  it("decidePushFailureAction은 403(nonRetryable)만 drop하고, 3회 초과 일시 오류는 큐를 보존한 채 pause한다", () => {
    expect(decidePushFailureAction({ nonRetryable: true, attemptCount: 0 })).toEqual({ action: "drop" });
    expect(decidePushFailureAction({ nonRetryable: false, attemptCount: 0 })).toEqual({
      action: "retry",
      delayMs: 3000,
    });
    expect(decidePushFailureAction({ nonRetryable: false, attemptCount: 1 })).toEqual({
      action: "retry",
      delayMs: 10000,
    });
    expect(decidePushFailureAction({ nonRetryable: false, attemptCount: 2 })).toEqual({
      action: "retry",
      delayMs: 30000,
    });
    expect(decidePushFailureAction({ nonRetryable: false, attemptCount: 3 })).toEqual({ action: "pause" });
    expect(decideNextPushRetryDelayMs({ stateKvSynced: false, nonRetryable: false, attemptCount: 3 })).toBeNull();
  });

  it("shouldEnqueueStateKvKeyForClient는 학생 계정의 금지 키(강의 트리, 드라이브 루트, 타 학생 키)를 사전 차단한다", () => {
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: SHARED_LECTURE_TREE_KEY,
        role: "s",
        studentToken: "tok-a",
      })
    ).toBe(false);
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: SHARED_DRIVE_ROOT_ID_KEY,
        role: "s",
        studentToken: "tok-a",
      })
    ).toBe(false);
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: sessionProgressByLeafIdKey("tok-b", 1),
        role: "s",
        studentToken: "tok-a",
      })
    ).toBe(false);
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: `${SHARED_META_MAP_PREFIX}tok-b`,
        role: "s",
        studentToken: "tok-a",
      })
    ).toBe(false);
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: sessionProgressByLeafIdKey("tok-a", 1),
        role: "s",
        studentToken: "tok-a",
      })
    ).toBe(true);
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: `${SHARED_META_MAP_PREFIX}tok-a`,
        role: "s",
        studentToken: "tok-a",
      })
    ).toBe(true);
    expect(
      shouldEnqueueStateKvKeyForClient({
        key: SHARED_LECTURE_TREE_KEY,
        role: "a",
        studentToken: null,
      })
    ).toBe(true);
  });
});
