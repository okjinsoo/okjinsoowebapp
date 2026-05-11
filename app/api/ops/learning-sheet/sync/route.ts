import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";
import { syncLearningSheetForTeacher } from "@/lib/server/learningSheet/syncFactory";

export const dynamic = "force-dynamic";

type SyncRequestBody = {
  teacherId?: string;
  studentId?: string;
  tabTitle?: string;
};

export async function POST(request: NextRequest) {
  try {
    const viewer = await resolveViewerContext(request);
    if (!viewer || viewer.role === "guest" || viewer.role === "student") {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as SyncRequestBody;

    const role = viewer.role;
    const requestedTeacherId = (body.teacherId ?? "").trim();
    const requestedStudentId = (body.studentId ?? "").trim();
    const requestedTabTitle = (body.tabTitle ?? "").trim();

    const teacherId =
      role === "teacher"
        ? (viewer.teacherId ?? "").trim()
        : requestedTeacherId || (viewer.teacherId ?? "").trim();

    if (!teacherId) {
      return NextResponse.json(
        { ok: false, error: "teacher_id_required" },
        { status: 400 }
      );
    }

    const teacher = viewer.snapshot.teachers.find((row) => row.id === teacherId) ?? null;
    if (!teacher) {
      return NextResponse.json({ ok: false, error: "teacher_not_found" }, { status: 404 });
    }

    if (role === "teacher") {
      const myTeacherId = (viewer.teacherId ?? "").trim();
      if (!myTeacherId || myTeacherId !== teacherId) {
        return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
      }
    }

    if (requestedStudentId) {
      const ownsStudent = viewer.snapshot.students.some(
        (row) => row.id === requestedStudentId && row.teacherId === teacherId
      );
      if (!ownsStudent) {
        return NextResponse.json({ ok: false, error: "student_not_owned" }, { status: 400 });
      }
    }

    const result = await syncLearningSheetForTeacher({
      teacher,
      students: viewer.snapshot.students,
      sessions: viewer.snapshot.sessions,
      stateKv: viewer.snapshot.stateKv,
      onlyStudentId: requestedStudentId || null,
      onlyTabTitle: requestedTabTitle || null,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "learning_sheet_sync_failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
