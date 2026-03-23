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

import * as snapshotApi from "@/lib/server/supabaseSnapshotApi";
import { GET as getSnapshot } from "@/app/api/snapshot/route";
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
});
