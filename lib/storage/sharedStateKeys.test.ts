import { describe, expect, it } from "vitest";
import {
  buildSessionStorageBaseKey,
  isSessionProgressStateKey,
  isSharedStateKvKey,
  sessionLeafIdsKey,
  sessionProgressByLeafIdKey,
  SHARED_CONSULTATIONS_KEY,
  SHARED_LECTURE_TREE_KEY,
  SHARED_META_MAP_PREFIX,
} from "@/lib/storage/sharedStateKeys";

describe("sharedStateKeys", () => {
  it("builds deterministic session keys", () => {
    expect(buildSessionStorageBaseKey("tok", 3)).toBe("mk3:tok:session:3");
    expect(sessionLeafIdsKey("tok", 3)).toBe("mk3:tok:session:3:leafIds");
    expect(sessionProgressByLeafIdKey("tok", 3)).toBe("mk3:tok:session:3:progressByLeafId");
  });

  it("detects session progress keys and shared state keys", () => {
    expect(isSessionProgressStateKey("mk3:abc:session:12:leafIds")).toBe(true);
    expect(isSessionProgressStateKey("mk3:abc:session:12:progressByLeafId")).toBe(true);
    expect(isSessionProgressStateKey("mk3:abc:session:12:lastAddedLeafId")).toBe(false);

    expect(isSharedStateKvKey(SHARED_CONSULTATIONS_KEY)).toBe(true);
    expect(isSharedStateKvKey(SHARED_LECTURE_TREE_KEY)).toBe(true);
    expect(isSharedStateKvKey(`${SHARED_META_MAP_PREFIX}abc`)).toBe(true);
    expect(isSharedStateKvKey("mk3:abc:session:12:leafIds")).toBe(true);
    expect(isSharedStateKvKey("mk3:abc:session:12:progressByLeafId")).toBe(true);
    expect(isSharedStateKvKey("mk3:abc:session:12:lastAddedLeafId")).toBe(false);
  });
});
