import { describe, expect, it } from "vitest";
import type { Session, Student } from "@/lib/types/index";
import {
  mapSessionToNormalizedRow,
  mapStudentToNormalizedRow,
} from "./dualWriteSync";

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
});
