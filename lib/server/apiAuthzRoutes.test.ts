import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ViewerContext } from "@/lib/server/supabaseSnapshotApi";
import type { Teacher } from "@/lib/types/index";

vi.mock("@/lib/server/supabaseSnapshotApi", () => ({
  resolveViewerContext: vi.fn(),
  upsertSnapshotPatch: vi.fn(),
  filterTeachersForViewer: vi.fn(),
  canReadStudent: vi.fn(),
  filterSessionsForStudent: vi.fn(),
}));

vi.mock("@/lib/server/autoAttendance", () => ({ runAutoAttendance: vi.fn() }));

import * as snapshotApi from "@/lib/server/supabaseSnapshotApi";
import * as autoAttendance from "@/lib/server/autoAttendance";
import { GET as getAutoPresent } from "@/app/api/ops/attendance/auto-present/route";
import { GET as getSnapshot, POST as postSnapshot } from "@/app/api/snapshot/route";
import { GET as getTeachers } from "@/app/api/teachers/route";
import { GET as getStudentSessions } from "@/app/api/students/[id]/sessions/route";

describe("API authz route guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("비로그인 상태에서 /api/snapshot은 401", async () => {
    vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost:3000/api/snapshot");
    const res = await getSnapshot(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "unauthorized" });
  });

  test("미등록(guest) 계정의 /api/snapshot은 403이고 명단을 받지 못함", async () => {
    const guestViewer = {
      role: "guest",
      teacherId: null,
      studentId: null,
      digest: "d",
      snapshot: {
        teachers: [],
        students: [{ id: "stu-1", name: "학생1" }],
        sessions: [],
        stateKv: {},
      },
    } as unknown as ViewerContext;
    vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce(guestViewer);

    const res = await getSnapshot(new NextRequest("http://localhost:3000/api/snapshot"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "forbidden" });
  });

  test("학생의 ?stateKey= 조회는 본인 키만 받고, 결제 장부·타 학생 키는 null", async () => {
    const stateKv = {
      "server:payment_orders_v1": "[{\"buyerPhone\":\"010\"}]",
      "mk3:other:session:1:progressByLeafId": "{\"x\":1}",
      "mk3:mine:session:1:progressByLeafId": "{\"y\":1}",
    };
    const studentViewer = {
      role: "student",
      teacherId: null,
      studentId: "stu-1",
      digest: "d",
      snapshot: {
        teachers: [],
        students: [{ id: "stu-1", token: "mine" }],
        sessions: [],
        stateKv,
      },
    } as unknown as ViewerContext;

    const read = async (key: string) => {
      vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce(studentViewer);
      const url = `http://localhost:3000/api/snapshot?stateKey=${encodeURIComponent(key)}`;
      return (await (await getSnapshot(new NextRequest(url))).json()).value;
    };

    expect(await read("server:payment_orders_v1")).toBeNull();
    expect(await read("mk3:other:session:1:progressByLeafId")).toBeNull();
    expect(await read("mk3:mine:session:1:progressByLeafId")).toBe("{\"y\":1}");
  });

  test("학생이 다른 학생 /api/students/:id/sessions 조회 시 403", async () => {
    const studentViewer = { role: "student" } as unknown as ViewerContext;
    vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce(studentViewer);
    vi.mocked(snapshotApi.canReadStudent).mockReturnValueOnce(false);

    const req = new NextRequest("http://localhost:3000/api/students/stu-2/sessions");
    const res = await getStudentSessions(req, {
      params: Promise.resolve({ id: "stu-2" }),
    });
    const body = await res.json();

    expect(snapshotApi.canReadStudent).toHaveBeenCalledWith(expect.anything(), "stu-2");
    expect(res.status).toBe(403);
    expect(body).toEqual({ error: "forbidden" });
  });

  test("관리자 계정의 /api/teachers 조회는 200", async () => {
    const teachers: Teacher[] = [
      { id: "t-1", name: "홍길동" },
      { id: "t-2", name: "김선생" },
    ] as unknown as Teacher[];
    const adminViewer = { role: "admin" } as unknown as ViewerContext;
    vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce(adminViewer);
    vi.mocked(snapshotApi.filterTeachersForViewer).mockReturnValueOnce(teachers);

    const req = new NextRequest("http://localhost:3000/api/teachers");
    const res = await getTeachers(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      teachers,
    });
  });

  test("POST /api/snapshot 토큰 만료/비로그인(unauthorized)은 401, 금지 키/권한 거절은 403으로 구분 응답", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.mocked(snapshotApi.upsertSnapshotPatch).mockRejectedValueOnce(new Error("unauthorized"));
    const req401 = new NextRequest("http://localhost:3000/api/snapshot", {
      method: "POST",
      body: JSON.stringify({ stateKv: { "mk3:tok:session:1:progressByLeafId": "{}" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res401 = await postSnapshot(req401);
    expect(res401.status).toBe(401);
    expect(await res401.json()).toEqual({ error: "unauthorized" });

    vi.mocked(snapshotApi.upsertSnapshotPatch).mockRejectedValueOnce(
      new Error("unauthorized_metadata_manipulation")
    );
    const req403 = new NextRequest("http://localhost:3000/api/snapshot", {
      method: "POST",
      body: JSON.stringify({ stateKv: { "mk3:lectureTree": "{}" } }),
      headers: { "Content-Type": "application/json" },
    });
    const res403 = await postSnapshot(req403);
    expect(res403.status).toBe(403);
    expect(await res403.json()).toEqual({ error: "forbidden" });

    errSpy.mockRestore();
  });

  test("자동 출석: 관리자 아님 → 401, 실행 안 함", async () => {
    vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce({ role: "teacher" } as unknown as ViewerContext);
    const res = await getAutoPresent(new NextRequest("http://localhost:3000/api/ops/attendance/auto-present"));
    expect(res.status).toBe(401);
    expect(autoAttendance.runAutoAttendance).not.toHaveBeenCalled();
  });

  test("자동 출석: 관리자 + dryRun=1 → 미리 세기로 실행", async () => {
    vi.mocked(snapshotApi.resolveViewerContext).mockResolvedValueOnce({ role: "admin" } as unknown as ViewerContext);
    vi.mocked(autoAttendance.runAutoAttendance).mockResolvedValueOnce({
      ok: true, dryRun: true, studentCount: 0, sessionCount: 0, changes: [], message: "",
    });
    const res = await getAutoPresent(new NextRequest("http://localhost:3000/api/ops/attendance/auto-present?dryRun=1"));
    expect(res.status).toBe(200);
    expect(autoAttendance.runAutoAttendance).toHaveBeenCalledWith({ dryRun: true });
  });
});
