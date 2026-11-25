import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import { loadLectureTree, parseLectureTreeRaw } from "@/lib/storage/lectures";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { SHARED_LECTURE_TREE_KEY } from "@/lib/shared/sharedStateKeys";
import { decideNextPushRetryDelayMs } from "@/lib/ui/common/SharedSnapshotAgent";

const originalWindow = (globalThis as { window?: unknown }).window;
const originalFetch = globalThis.fetch;

describe("Incoming 트래픽 폭주 방지 회귀 테스트 (lectureTree 읽기 + 401/403 재시도 차단)", () => {
  const dispatchedEvents: Array<{ type: string; detail?: unknown }> = [];

  beforeEach(() => {
    vi.restoreAllMocks();
    dispatchedEvents.length = 0;
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
    // 일부러 createdAt이 누락된 레거시 형태여도 읽기 과정에서 원격 POST 이벤트를 발생시키면 안 된다.
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

  it("pushSharedSnapshot은 401/403 권한 거절 시 nonRetryable=true를 반환해 무한 재전송을 막는다", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    }) as unknown as typeof fetch;

    const res401 = await pushSharedSnapshot({
      stateKv: { [SHARED_LECTURE_TREE_KEY]: "{}" },
    });
    expect(res401.stateKvSynced).toBe(false);
    expect(res401.httpStatus).toBe(401);
    expect(res401.nonRetryable).toBe(true);

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "update_failed" }),
    }) as unknown as typeof fetch;

    const res500 = await pushSharedSnapshot({
      stateKv: { [SHARED_LECTURE_TREE_KEY]: "{}" },
    });
    expect(res500.stateKvSynced).toBe(false);
    expect(res500.httpStatus).toBe(500);
    expect(res500.nonRetryable).toBe(false);
  });

  it("decideNextPushRetryDelayMs는 401/403(nonRetryable)이면 즉시 중단하고, 일시 오류는 최대 3회 백오프 후 중단한다", () => {
    expect(decideNextPushRetryDelayMs({ stateKvSynced: true, attemptCount: 0 })).toBeNull();
    expect(decideNextPushRetryDelayMs({ stateKvSynced: false, nonRetryable: true, attemptCount: 0 })).toBeNull();
    expect(decideNextPushRetryDelayMs({ stateKvSynced: false, nonRetryable: false, attemptCount: 0 })).toBe(3000);
    expect(decideNextPushRetryDelayMs({ stateKvSynced: false, nonRetryable: false, attemptCount: 1 })).toBe(10000);
    expect(decideNextPushRetryDelayMs({ stateKvSynced: false, nonRetryable: false, attemptCount: 2 })).toBe(30000);
    expect(decideNextPushRetryDelayMs({ stateKvSynced: false, nonRetryable: false, attemptCount: 3 })).toBeNull();
  });
});
