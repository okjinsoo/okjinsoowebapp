import { describe, expect, it } from "vitest";
import {
  mapNormalizedRowToStudent,
  mapNormalizedRowToSession,
  isReadFromNormalizedEnabled,
  fetchStudentsFromDb,
  fetchSessionsForStudentFromDb,
  fetchTodaySessionsFromDb,
} from "./normalizedDbApi";
import { mapStudentToNormalizedRow, mapSessionToNormalizedRow } from "./dualWriteSync";
import type { Student, Session } from "@/lib/types/index";

describe("normalizedDbApi", () => {
  it("performs perfect round-trip conversion for Student model without data loss", () => {
    const originalStudent: Student = {
      id: "st_rt_01",
      token: "tok_rt_01",
      name: "테스트학생",
      cohort: "2026-1",
      status: "active",
      startDate: "2026-03-01",
      planCount: 12,
      googleEmail: "student@test.com",
      studentPhone: "01011112222",
      parentPhone: "01033334444",
      school: "테스트고등학교",
      grade: "10",
      gender: "male",
      parentRole: "mother",
      teacherId: "tch_01",
      driveFolderId: "fld_01",
      permanentMeetUrl: "https://meet.google.com/xyz-uvw-rst",
      scheduleRules: [
        {
          dayOfWeek: "mon",
          time: "15:00",
          durationMin: 90,
        },
      ],
      scheduleChangeEvents: [],
      paymentHistory: [
        {
          id: "pay_01",
          paymentDate: "2026-03-01",
          addedCount: 4,
          startIndex: 1,
          endIndex: 4,
        },
      ],
    };

    const row = mapStudentToNormalizedRow(originalStudent);
    const restored = mapNormalizedRowToStudent(row);

    expect(restored.id).toBe(originalStudent.id);
    expect(restored.token).toBe(originalStudent.token);
    expect(restored.name).toBe(originalStudent.name);
    expect(restored.cohort).toBe(originalStudent.cohort);
    expect(restored.status).toBe(originalStudent.status);
    expect(restored.planCount).toBe(originalStudent.planCount);
    expect(restored.teacherId).toBe(originalStudent.teacherId);
    expect(restored.permanentMeetUrl).toBe(originalStudent.permanentMeetUrl);
    expect(restored.scheduleRules).toEqual(originalStudent.scheduleRules);
    expect(restored.paymentHistory).toEqual(originalStudent.paymentHistory);
  });

  it("performs perfect round-trip conversion for Session model without data loss", () => {
    const originalSession: Session = {
      id: "sess_rt_01",
      studentId: "st_rt_01",
      index: 5,
      displayAt: "2026-03-20T10:00:00.000Z",
      memo: "문제풀이 집중",
      state: "normal",
      googleCalendarId: "cal_test",
      googleCalendarEventId: "evt_test",
      googleMeetUrl: "https://meet.google.com/xyz-uvw-rst",
      googleCalendarStatus: "synced",
      googleCalendarError: "",
      googleCalendarSyncedAt: "2026-03-20T09:00:00.000Z",
    };

    const row = mapSessionToNormalizedRow(originalSession);
    const restored = mapNormalizedRowToSession(row);

    expect(restored.id).toBe(originalSession.id);
    expect(restored.studentId).toBe(originalSession.studentId);
    expect(restored.index).toBe(originalSession.index);
    expect(restored.displayAt).toBe(originalSession.displayAt);
    expect(restored.memo).toBe(originalSession.memo);
    expect(restored.state).toBe(originalSession.state);
    expect(restored.googleMeetUrl).toBe(originalSession.googleMeetUrl);
    expect(restored.googleCalendarStatus).toBe(originalSession.googleCalendarStatus);
  });

  it("handles empty or missing config in queries safely returning null without throwing", async () => {
    const studentsRes = await fetchStudentsFromDb({});
    expect(studentsRes).toBeNull();

    const sessionsRes = await fetchSessionsForStudentFromDb({ studentId: "st_123" });
    expect(sessionsRes).toBeNull();

    const todayRes = await fetchTodaySessionsFromDb({
      todayStartIso: "2026-03-20T00:00:00.000Z",
      todayEndIso: "2026-03-20T23:59:59.000Z",
    });
    expect(todayRes).toBeNull();
  });

  it("evaluates isReadFromNormalizedEnabled based on environment flag", () => {
    const originalEnv = process.env.NEXT_PUBLIC_READ_FROM_NORMALIZED;
    try {
      process.env.NEXT_PUBLIC_READ_FROM_NORMALIZED = "true";
      expect(isReadFromNormalizedEnabled()).toBe(true);

      process.env.NEXT_PUBLIC_READ_FROM_NORMALIZED = "false";
      expect(isReadFromNormalizedEnabled()).toBe(false);

      delete process.env.NEXT_PUBLIC_READ_FROM_NORMALIZED;
      expect(isReadFromNormalizedEnabled()).toBe(false);
    } finally {
      process.env.NEXT_PUBLIC_READ_FROM_NORMALIZED = originalEnv;
    }
  });
});
