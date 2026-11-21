import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Session, Student } from "@/lib/types/index";
import {
  computeChangedRowsById,
  mapSessionToNormalizedRow,
  mapStudentToNormalizedRow,
} from "./dualWriteSync";
import {
  filterTeacherAllowedSessionMergePatch,
  filterTeacherAllowedStudentMergePatch,
  mergeSnapshotEntitiesById,
} from "./supabaseSnapshotApi";

describe("Phase 3: dualWriteSync mapping tests", () => {
  it("converts a Student domain object into a clean normalized row with proper fields and defaults", () => {
    const mockStudent: Student = {
      id: "st_123",
      token: "tok_abc",
      name: "홍길동",
      cohort: "2026",
      status: "active",
      startDate: "2026-03-01",
      planCount: 8,
      googleEmail: "student@gmail.com",
      studentPhone: "01011112222",
      parentPhone: "01033334444",
      school: "한국고",
      grade: "2",
      gender: "male",
      parentRole: "mother",
      teacherId: "tch_999",
      driveFolderId: "fld_xyz",
      permanentMeetUrl: "https://meet.google.com/abc-defg-hij",
      scheduleRules: [
        { weekday: 1, hour: 17, minute: 30, durationMin: 90 },
      ],
      scheduleChangeEvents: [
        {
          id: "chg_1",
          startIndex: 5,
          startDate: "2026-04-01",
          newRules: [{ weekday: 2, hour: 18, minute: 0, durationMin: 120 }],
        },
      ],
      paymentHistory: [
        {
          id: "pay_1",
          paymentDate: "2026-03-01",
          addedCount: 4,
          startIndex: 1,
          endIndex: 4,
        },
      ],
    };

    const row = mapStudentToNormalizedRow(mockStudent);

    expect(row.id).toBe("st_123");
    expect(row.token).toBe("tok_abc");
    expect(row.name).toBe("홍길동");
    expect(row.cohort).toBe("2026");
    expect(row.status).toBe("active");
    expect(row.start_date).toBe("2026-03-01");
    expect(row.plan_count).toBe(8);
    expect(row.google_email).toBe("student@gmail.com");
    expect(row.teacher_id).toBe("tch_999");
    expect(row.permanent_meet_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(Array.isArray(row.schedule_rules)).toBe(true);
    expect(row.schedule_rules).toHaveLength(1);
    expect(row.schedule_change_events).toHaveLength(1);
    expect(row.payment_history).toHaveLength(1);
    expect(row.updated_at).toBeDefined();
  });

  it("handles missing optional student fields with safe fallbacks", () => {
    const minimalStudent: Student = {
      id: "st_min",
      token: "",
      name: "김철수",
      cohort: "",
      status: "active",
      startDate: "",
      planCount: 4,
      googleEmail: "",
      studentPhone: "",
      parentPhone: "",
      school: "",
      grade: "",
      scheduleRules: [],
    };

    const row = mapStudentToNormalizedRow(minimalStudent);

    expect(row.id).toBe("st_min");
    expect(row.name).toBe("김철수");
    expect(row.token).toBeNull();
    expect(row.teacher_id).toBeNull();
    expect(row.drive_folder_id).toBeNull();
    expect(row.permanent_meet_url).toBeNull();
    expect(row.start_date).toBeNull();
    expect(row.google_email).toBeNull();
    expect(row.schedule_rules).toEqual([]);
    expect(row.schedule_change_events).toEqual([]);
    expect(row.payment_history).toEqual([]);
  });

  it("converts a Session domain object into a clean normalized row with proper fields", () => {
    const mockSession: Session = {
      id: "sess_001",
      studentId: "st_123",
      index: 3,
      displayAt: "2026-03-15T17:30:00.000Z",
      memo: "수업 보강 필요",
      state: "changed",
      googleCalendarId: "cal_primary",
      googleCalendarEventId: "evt_987",
      googleMeetUrl: "https://meet.google.com/abc-defg-hij",
      googleCalendarStatus: "synced",
      googleCalendarError: "",
      googleCalendarSyncedAt: "2026-03-15T10:00:00.000Z",
    };

    const row = mapSessionToNormalizedRow(mockSession);

    expect(row.id).toBe("sess_001");
    expect(row.student_id).toBe("st_123");
    expect(row.session_index).toBe(3);
    expect(row.display_at).toBe("2026-03-15T17:30:00.000Z");
    expect(row.memo).toBe("수업 보강 필요");
    expect(row.state).toBe("changed");
    expect(row.google_calendar_id).toBe("cal_primary");
    expect(row.google_calendar_event_id).toBe("evt_987");
    expect(row.google_meet_url).toBe("https://meet.google.com/abc-defg-hij");
    expect(row.google_calendar_status).toBe("synced");
    expect(row.updated_at).toBeDefined();
  });

  it("handles empty or missing config in dualWriteSync and backfill safely without throwing", async () => {
    const { executeDualWriteSync, backfillNormalizedTables, getNormalizedTableCounts } = await import("./dualWriteSync");

    const syncRes = await executeDualWriteSync({});
    expect(syncRes.studentsWritten).toBe(0);
    expect(syncRes.sessionsWritten).toBe(0);

    const counts = await getNormalizedTableCounts({});
    expect(counts.studentsCount).toBe(0);
    expect(counts.sessionsCount).toBe(0);

    const backfillRes = await backfillNormalizedTables({ students: [], sessions: [] });
    expect(backfillRes.studentsTotal).toBe(0);
    expect(backfillRes.sessionsTotal).toBe(0);
    expect(backfillRes.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("B단계: computeChangedRowsById returns only newly added or modified rows", () => {
    const prev = [
      { id: "s1", displayAt: "2026-03-02T08:00:00.000Z" },
      { id: "s2", displayAt: "2026-03-04T08:00:00.000Z" },
      { id: "s3", displayAt: "2026-03-09T08:00:00.000Z" },
    ];
    const next = [
      { id: "s1", displayAt: "2026-03-02T08:00:00.000Z" },
      { id: "s2", displayAt: "2026-03-05T08:00:00.000Z" }, // modified
      { id: "s3", displayAt: "2026-03-09T08:00:00.000Z" },
      { id: "s4", displayAt: "2026-03-11T08:00:00.000Z" }, // added
    ];

    const changed = computeChangedRowsById(prev, next);
    expect(changed.map((r) => r.id)).toEqual(["s2", "s4"]);
  });

  it("B단계: mergeSnapshotEntitiesById preserves concurrent edits on untouched items", () => {
    const serverLatest = [
      { id: "s1", studentId: "stu-a", displayAt: "2026-03-02T08:00:00.000Z" },
      { id: "s2", studentId: "stu-b", displayAt: "2026-03-06T10:00:00.000Z" }, // edited concurrently by another teacher
    ];
    const partialPatch = [
      { id: "s1", studentId: "stu-a", displayAt: "2026-03-03T09:00:00.000Z" },
    ];

    const merged = mergeSnapshotEntitiesById(serverLatest, partialPatch);
    expect(merged).toEqual([
      { id: "s1", studentId: "stu-a", displayAt: "2026-03-03T09:00:00.000Z" },
      { id: "s2", studentId: "stu-b", displayAt: "2026-03-06T10:00:00.000Z" },
    ]);
  });

  it("C-2 보완: filterTeacherAllowedStudentMergePatch blocks hijacking another teacher's existing student", () => {
    const existing = [
      { id: "stu-mine", teacherId: "t-1", name: "내학생" },
      { id: "stu-other", teacherId: "t-2", name: "타선생학생" },
    ] as unknown as Student[];

    const incoming = [
      { id: "stu-mine", teacherId: "t-1", name: "내학생(수정)" },
      // 타 선생님 학생 ID에 자기 teacherId("t-1")를 넣어 탈취 시도 -> 반드시 차단!
      { id: "stu-other", teacherId: "t-1", name: "탈취시도" },
      // 신규 학생 등록(본인 담당) -> 허용
      { id: "stu-new", teacherId: "t-1", name: "신규학생" },
    ] as unknown as Student[];

    const allowed = filterTeacherAllowedStudentMergePatch(existing, incoming, "t-1");
    expect(allowed.map((s) => s.id)).toEqual(["stu-mine", "stu-new"]);
  });

  it("최종 보안 점검: filterTeacherAllowedSessionMergePatch blocks overwriting another teacher's existing session ID", () => {
    const existingSessions = [
      { id: "sess-mine", studentId: "stu-mine", index: 1, displayAt: "", state: "normal" },
      { id: "sess-other", studentId: "stu-other", index: 1, displayAt: "", state: "normal" },
    ] as unknown as Session[];
    const myStudentIds = new Set(["stu-mine"]);

    const incoming = [
      { id: "sess-mine", studentId: "stu-mine", index: 1, displayAt: "2026-03-03T08:00:00.000Z", state: "normal" },
      // 타 선생님 세션 ID에 본인 학생 ID를 덮어씌워 탈취 시도 -> 반드시 차단!
      { id: "sess-other", studentId: "stu-mine", index: 1, displayAt: "2026-03-03T08:00:00.000Z", state: "normal" },
      // 신규 세션(본인 학생 소속) -> 허용
      { id: "sess-new", studentId: "stu-mine", index: 2, displayAt: "2026-03-05T08:00:00.000Z", state: "normal" },
    ] as unknown as Session[];

    const allowed = filterTeacherAllowedSessionMergePatch(existingSessions, incoming, myStudentIds);
    expect(allowed.map((s) => s.id)).toEqual(["sess-mine", "sess-new"]);
  });
});
