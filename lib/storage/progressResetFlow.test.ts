import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// mock fetch globally
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

import { calculateSnapshotDigest, upsertSnapshotPatch } from "@/lib/server/supabaseSnapshotApi";
import { isSharedStateKvKey, sessionProgressByLeafIdKey } from "@/lib/storage/sharedStateKeys";
import { NextRequest } from "next/server";

describe("Progress state saving flow", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
  });

  it("verifies sessionProgressByLeafIdKey format and validation", () => {
    const key = sessionProgressByLeafIdKey("3DQbYNbkJGMd", 6);
    expect(key).toBe("mk3:3DQbYNbkJGMd:session:6:progressByLeafId");
    expect(isSharedStateKvKey(key)).toBe(true);
  });

  it("handles stateKv payload correctly in upsertSnapshotPatch", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/auth/v1/user")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "user-1", email: "teacher@test.com" }),
          text: async () => "",
        };
      }
      if (url.includes("/rest/v1/app_state_snapshots")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "main",
              teachers: [{ id: "t-1", email: "teacher@test.com" }],
              students: [],
              sessions: [],
              state_kv: {
                "mk3:stu1:session:1:progressByLeafId": JSON.stringify({ leaf1: { solveDone: true } }),
              },
              updated_at: "2026-01-01",
            },
          ],
          text: async () => "",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "",
      };
    });

    const req = new NextRequest("http://localhost:3000/api/snapshot", {
      headers: {
        authorization: "Bearer test-token",
      },
    });

    const key = "mk3:stu1:session:1:progressByLeafId";
    const nextProg = { leaf1: { solveDone: false, solveLink: "" } };

    const result = await upsertSnapshotPatch({
      request: req,
      patch: {
        stateKv: {
          [key]: JSON.stringify(nextProg),
        },
      },
    });

    expect(result.stateKvSynced).toBe(true);
  });

  it("changes snapshot digest when any student session progress changes even with trailing metaMap keys", () => {
    const baseStateKv: Record<string, string> = {
      "mk3:studentA:session:35:leafIds": JSON.stringify(["leaf_1"]),
      "mk3:studentA:session:35:progressByLeafId": JSON.stringify({
        leaf_1: { noteDone: false, solveDone: false },
      }),
      // 알파벳 뒤쪽에 위치한 키 3개 이상 존재 시나리오
      "tutorweb_metaMap_v1:studentX": JSON.stringify({ 1: { status: "present" } }),
      "tutorweb_metaMap_v1:studentY": JSON.stringify({ 1: { status: "present" } }),
      "tutorweb_metaMap_v1:studentZ": JSON.stringify({ 1: { status: "present" } }),
    };

    const updatedStateKv: Record<string, string> = {
      ...baseStateKv,
      "mk3:studentA:session:35:progressByLeafId": JSON.stringify({
        leaf_1: { noteDone: true, solveDone: true },
      }),
    };

    const digestBefore = calculateSnapshotDigest({
      teachers: [],
      students: [],
      sessions: [],
      stateKv: baseStateKv,
    });
    const digestAfter = calculateSnapshotDigest({
      teachers: [],
      students: [],
      sessions: [],
      stateKv: updatedStateKv,
    });

    expect(digestBefore).not.toBe(digestAfter);
  });
});
