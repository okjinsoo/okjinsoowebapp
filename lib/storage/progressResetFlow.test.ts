import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// mock fetch globally
const fetchMock = vi.fn();
globalThis.fetch = fetchMock;

import {
  calculateSnapshotDigest,
  isStudentAllowedStateKvKey,
  upsertSnapshotPatch,
} from "@/lib/server/supabaseSnapshotApi";
import { filterStateKvForViewer, isTeacherAllowedStateKvKey } from "@/lib/server/snapshotFilter";
import { validatePaymentConfirmInput } from "@/lib/server/paymentValidation";
import {
  mapDbRowToPaymentOrder,
  mapPaymentOrderToDbRow,
  recordConfirmedPaymentOrder,
  SERVER_PAYMENT_ORDERS_KV_KEY,
} from "@/lib/server/paymentOrderStore";
import { isSharedStateKvKey, sessionProgressByLeafIdKey } from "@/lib/shared/sharedStateKeys";
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

  it("allows student to update only their own session progress or metaMap keys and blocks others", async () => {
    expect(isStudentAllowedStateKvKey("mk3:tok_studentA:session:3:items", "tok_studentA")).toBe(true);
    expect(isStudentAllowedStateKvKey("mk3:tok_studentA:session:3:progressByLeafId", "tok_studentA")).toBe(true);
    expect(isStudentAllowedStateKvKey("tutorweb_metaMap_v1:tok_studentA", "tok_studentA")).toBe(true);

    // 타 학생의 키 및 전역 강의 트리 조작 차단 검증
    expect(isStudentAllowedStateKvKey("mk3:tok_studentB:session:3:items", "tok_studentA")).toBe(false);
    expect(isStudentAllowedStateKvKey("mk3:lectureTree", "tok_studentA")).toBe(false);
    expect(isStudentAllowedStateKvKey("tutorweb_metaMap_v1:tok_studentB", "tok_studentA")).toBe(false);

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/auth/v1/user")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "u-stu-a", email: "studenta@test.com" }),
          text: async () => "",
        };
      }
      if (url.includes("/rest/v1/role_bindings")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ role: "student" }],
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
              teachers: [],
              students: [
                {
                  id: "s-a",
                  token: "tok_studentA",
                  name: "학생A",
                  googleEmail: "studenta@test.com",
                  status: "active",
                },
              ],
              sessions: [],
              state_kv: {},
            },
          ],
          text: async () => "",
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    });

    const makeReq = () =>
      new NextRequest("http://localhost:3000/api/snapshot", {
        headers: { authorization: "Bearer student-token" },
      });

    // 1. 본인 토큰 키 수정은 정상 통과해야 함
    const okResult = await upsertSnapshotPatch({
      request: makeReq(),
      patch: {
        stateKv: {
          "mk3:tok_studentA:session:1:items": JSON.stringify([{ noteDone: true, solveDone: true }]),
        },
      },
    });
    expect(okResult.stateKvSynced).toBe(true);

    // 2. 타 학생 키 수정 시도는 즉시 차단되어야 함
    await expect(
      upsertSnapshotPatch({
        request: makeReq(),
        patch: {
          stateKv: {
            "mk3:tok_studentB:session:1:items": JSON.stringify([{ noteDone: false, solveDone: false }]),
          },
        },
      })
    ).rejects.toThrow("unauthorized_metadata_manipulation");
  });

  it("validates payment confirm parameters and blocks tampered amounts or invalid orderIds", () => {
    expect(
      validatePaymentConfirmInput({
        paymentKey: "pay_12345",
        orderId: "OJS_1730000000000_1234",
        amount: 360000,
      }).ok
    ).toBe(true);

    // 금액 위변조(100원) 차단
    const tampered = validatePaymentConfirmInput({
      paymentKey: "pay_12345",
      orderId: "OJS_1730000000000_1234",
      amount: 100,
    });
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.code).toBe("AMOUNT_MISMATCH");
    }

    // 잘못된 주문번호 형식 차단
    const badOrder = validatePaymentConfirmInput({
      paymentKey: "pay_12345",
      orderId: "HACK_123",
      amount: 360000,
    });
    expect(badOrder.ok).toBe(false);
    if (!badOrder.ok) {
      expect(badOrder.code).toBe("INVALID_ORDER_ID");
    }
  });

  it("filters stateKv for teacher to include only assigned students and global keys, and uses atomic RPC when available", async () => {
    const rawStateKv: Record<string, string> = {
      "mk3:lectureTree": '{"root":{}}',
      "mk3:driveRootId": "drive_123",
      "mk3:tok_myStudent:session:1:items": '[{"noteDone":true}]',
      "tutorweb_metaMap_v1:tok_myStudent": '{"1":{"status":"present"}}',
      "mk3:tok_otherStudent:session:1:items": '[{"noteDone":false}]',
      "tutorweb_metaMap_v1:tok_otherStudent": '{"1":{"status":"absent"}}',
    };

    const myTokens = new Set(["tok_myStudent"]);
    const filteredForTeacher = filterStateKvForViewer(rawStateKv, {
      role: "teacher",
      studentId: null,
      teacherStudentTokens: myTokens,
    });

    expect(filteredForTeacher["mk3:lectureTree"]).toBeDefined();
    expect(filteredForTeacher["mk3:driveRootId"]).toBeDefined();
    expect(filteredForTeacher["mk3:tok_myStudent:session:1:items"]).toBeDefined();
    expect(filteredForTeacher["tutorweb_metaMap_v1:tok_myStudent"]).toBeDefined();
    expect(filteredForTeacher["mk3:tok_otherStudent:session:1:items"]).toBeUndefined();
    expect(filteredForTeacher["tutorweb_metaMap_v1:tok_otherStudent"]).toBeUndefined();

    expect(isTeacherAllowedStateKvKey("mk3:tok_myStudent:session:2:items", myTokens)).toBe(true);
    expect(isTeacherAllowedStateKvKey("mk3:tok_otherStudent:session:2:items", myTokens)).toBe(false);
    expect(isTeacherAllowedStateKvKey("mk3:lectureTree", myTokens)).toBe(true);

    // 원자적 RPC(patch_snapshot_state_kv)가 true를 반환하면 전체 테이블 Upsert 없이 즉시 완료되는지 검증
    let rpcCalledWith: { p_patch?: Record<string, string> } = {};
    let fullTableUpsertCalled = false;

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/auth/v1/user")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "u-tch-1", email: "teacher1@test.com" }),
          text: async () => "",
        };
      }
      if (url.includes("/rest/v1/role_bindings")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ role: "teacher" }],
          text: async () => "",
        };
      }
      if (url.includes("/rest/v1/rpc/patch_snapshot_state_kv")) {
        rpcCalledWith = JSON.parse(String(init?.body ?? "{}")) as { p_patch?: Record<string, string> };
        return {
          ok: true,
          status: 200,
          json: async () => true,
          text: async () => "true",
        };
      }
      if (url.includes("/rest/v1/app_state_snapshots")) {
        if (init?.method === "POST") {
          fullTableUpsertCalled = true;
        }
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "main",
              teachers: [{ id: "t-1", email: "teacher1@test.com", name: "김선생" }],
              students: [
                { id: "s-1", token: "tok_myStudent", teacherId: "t-1", name: "내학생", status: "active" },
                { id: "s-2", token: "tok_otherStudent", teacherId: "t-2", name: "남의학생", status: "active" },
              ],
              sessions: [],
              state_kv: {},
            },
          ],
          text: async () => "",
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    });

    const req = new NextRequest("http://localhost:3000/api/snapshot", {
      headers: { authorization: "Bearer teacher-token" },
    });

    const res = await upsertSnapshotPatch({
      request: req,
      patch: {
        stateKv: {
          "mk3:tok_myStudent:session:1:items": '[{"noteDone":true}]',
          "mk3:tok_otherStudent:session:1:items": '[{"noteDone":false}]',
        },
      },
    });

    expect(res.stateKvSynced).toBe(true);
    // 선생님이 보낸 패치 중 본인 담당 학생(tok_myStudent) 키만 RPC에 전달되고 남의 학생 키는 걸러졌는지 확인
    const patchSent = rpcCalledWith.p_patch ?? {};
    expect(patchSent["mk3:tok_myStudent:session:1:items"]).toBeDefined();
    expect(patchSent["mk3:tok_otherStudent:session:1:items"]).toBeUndefined();
    // 원자적 RPC가 성공했으므로 무거운 전체 행 POST Upsert는 생략되었어야 함
    expect(fullTableUpsertCalled).toBe(false);
  });

  it("records confirmed payment order to payment_orders table and snapshot fallback ledger", async () => {
    let insertedTableRow: Record<string, unknown> = {};
    let patchedSnapshotKv: Record<string, string> = {};

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes("/rest/v1/payment_orders")) {
        const parsed = JSON.parse(String(init?.body ?? "[]")) as Array<Record<string, unknown>>;
        insertedTableRow = parsed[0] ?? {};
        return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
      }
      if (url.includes("/rest/v1/app_state_snapshots") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ state_kv: {} }],
          text: async () => "",
        };
      }
      if (url.includes("/rest/v1/rpc/patch_snapshot_state_kv")) {
        const bodyObj = JSON.parse(String(init?.body ?? "{}")) as { p_patch: Record<string, string> };
        patchedSnapshotKv = bodyObj.p_patch ?? {};
        return {
          ok: true,
          status: 200,
          json: async () => true,
          text: async () => "true",
        };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    });

    const sampleOrder = {
      orderId: "OJS_1730000000000_9999",
      paymentKey: "pay_live_abc123",
      programId: "group-lesson",
      orderName: "180분 그룹 수업 (4회) + 90분 개별 피드백 (4회)",
      amount: 360000,
      buyerName: "김학부모",
      buyerPhone: "010-9999-8888",
      studentName: "김수강",
      status: "DONE",
      method: "카드",
      approvedAt: "2026-11-13T15:00:00+09:00",
      receiptUrl: "https://receipt.tosspayments.com/test",
      createdAt: "2026-11-13T15:00:00+09:00",
    };

    const dbRow = mapPaymentOrderToDbRow(sampleOrder, { raw: true });
    const roundTrip = mapDbRowToPaymentOrder(dbRow);
    expect(roundTrip.orderId).toBe(sampleOrder.orderId);
    expect(roundTrip.buyerPhone).toBe("010-9999-8888");
    expect(roundTrip.studentName).toBe("김수강");

    const ledgerRes = await recordConfirmedPaymentOrder(sampleOrder, { toss: "ok" });
    expect(ledgerRes.savedToTable).toBe(true);
    expect(ledgerRes.savedToSnapshotFallback).toBe(true);
    expect(insertedTableRow.buyer_phone).toBe("010-9999-8888");
    expect(patchedSnapshotKv[SERVER_PAYMENT_ORDERS_KV_KEY]).toContain("010-9999-8888");
  });
});
