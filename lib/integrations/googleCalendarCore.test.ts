import { describe, expect, it } from "vitest";

import {
  APP_EVENT_MARKER,
  buildEventPayload,
  extractMeetUrl,
  formatKstRfc3339,
  isManagedStudentEvent,
  orderSyncTargets,
  parseCandidateEvents,
  selectProvisionalSyncTargets,
  selectRemovedEventsToDelete,
  selectSyncTargets,
  sessionNeedsUpsert,
} from "@/lib/integrations/googleCalendarCore";
import type { Session, Student, Teacher } from "@/lib/types/index";

/**
 * 구글 캘린더 "순수 계산" 부분 동작 고정 테스트
 * (googleCalendarSync.ts에서 그대로 옮겨온 함수들이 앞으로도 같은 답을 내는지 확인)
 */

const student: Student = {
  id: "stu1",
  token: "tok1",
  name: "홍길동",
  cohort: "2026_test",
  status: "active",
  startDate: "2026-11-01",
  planCount: 12,
  scheduleRules: [{ weekday: 1, hour: 18, minute: 0, durationMin: 90 }],
  googleEmail: "Student@Example.com",
  studentPhone: "01000000000",
  parentPhone: "01000000001",
  school: "테스트중",
  grade: "8",
};

const teacher: Teacher = { id: "t1", token: "tt1", name: "김선생", email: "t@example.com" };

type EventPayload = {
  summary: string;
  description: string;
  location?: string;
  start: unknown;
  end: unknown;
  attendees: unknown;
  extendedProperties: { private: unknown };
  conferenceData?: { createRequest: { conferenceSolutionKey: unknown } };
};

const session: Session = {
  id: "s1",
  studentId: "stu1",
  index: 3,
  displayAt: "2026-11-30T09:00:00.000Z", // KST 18:00
  state: "normal",
};

describe("formatKstRfc3339", () => {
  it("UTC 시각을 한국 시간(+09:00) 표기로 바꾼다", () => {
    expect(formatKstRfc3339("2026-11-30T09:00:00.000Z")).toBe("2026-11-30T18:00:00+09:00");
  });
  it("날짜가 아니면 null", () => {
    expect(formatKstRfc3339("not-a-date")).toBeNull();
  });
});

describe("buildEventPayload", () => {
  it("제목·한국시간·수업 길이·참석자·표식이 들어간 일정 내용을 만든다", () => {
    const payload = buildEventPayload({
      session,
      student,
      teacher,
      includeMeetCreateRequest: false,
    }) as EventPayload;

    expect(payload.summary).toBe("홍길동 3회차 수업");
    expect(payload.start).toEqual({ dateTime: "2026-11-30T18:00:00+09:00", timeZone: "Asia/Seoul" });
    expect(payload.end).toEqual({ dateTime: "2026-11-30T19:30:00+09:00", timeZone: "Asia/Seoul" });
    expect(payload.attendees).toEqual([{ email: "student@example.com" }]);
    expect(payload.description.split("\n")[0]).toBe(APP_EVENT_MARKER);
    expect(payload.description).toContain("선생님: 김선생");
    expect(payload.description).toContain("수업시간: 90분");
    expect(payload.extendedProperties.private).toEqual({
      tutorweb_session_id: "s1",
      tutorweb_student_id: "stu1",
    });
    expect(payload.conferenceData).toBeUndefined();
  });

  it("영구 Meet 링크가 없고 요청하면 새 Meet 생성 요청을 넣는다", () => {
    const payload = buildEventPayload({
      session,
      student,
      teacher,
      includeMeetCreateRequest: true,
    }) as EventPayload;
    expect(payload.conferenceData?.createRequest.conferenceSolutionKey).toEqual({ type: "hangoutsMeet" });
  });

  it("영구 Meet 링크가 있으면 새로 만들지 않고 장소에 그 링크를 넣는다", () => {
    const payload = buildEventPayload({
      session,
      student: { ...student, permanentMeetUrl: "https://meet.google.com/perm" },
      teacher,
      includeMeetCreateRequest: true,
    }) as EventPayload;
    expect(payload.conferenceData).toBeUndefined();
    expect(payload.location).toBe("https://meet.google.com/perm");
  });

  it("회차 시간이 잘못되면 null", () => {
    expect(
      buildEventPayload({ session: { ...session, displayAt: "" }, student, teacher, includeMeetCreateRequest: false })
    ).toBeNull();
  });
});

describe("구글 응답 해석", () => {
  const body = {
    items: [
      {
        id: "evt1",
        summary: "홍길동 3회차 수업",
        description: `${APP_EVENT_MARKER}\n학생: 홍길동`,
        created: "2026-11-01T00:00:00.000Z",
        start: { dateTime: "2026-11-30T18:00:00+09:00" },
        attendees: [{ email: "Student@Example.com" }, { email: "student@example.com" }],
        hangoutLink: "https://meet.google.com/abc",
        extendedProperties: { private: { tutorweb_session_id: "s1", tutorweb_student_id: "stu1" } },
      },
      { summary: "id 없는 일정은 무시" },
    ],
  };

  it("parseCandidateEvents: id 없는 일정은 버리고, 참석자 이메일은 소문자·중복 제거", () => {
    const events = parseCandidateEvents(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      eventId: "evt1",
      meetUrl: "https://meet.google.com/abc",
      startIso: "2026-11-30T09:00:00.000Z",
      sessionId: "s1",
      studentId: "stu1",
      attendeeEmails: ["student@example.com"],
    });
  });

  it("extractMeetUrl: hangoutLink가 없으면 conferenceData의 video 주소를 쓴다", () => {
    expect(
      extractMeetUrl({
        conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:1" }, { entryPointType: "video", uri: "https://meet.google.com/xyz" }] },
      })
    ).toBe("https://meet.google.com/xyz");
  });

  it("isManagedStudentEvent: 앱 표식 + 같은 학생 ID면 이 학생의 일정으로 본다", () => {
    const [event] = parseCandidateEvents(body);
    const base = { event, studentName: "홍길동", studentEmail: "", teacherEmail: "" };
    expect(isManagedStudentEvent({ ...base, studentId: "stu1" })).toBe(true);
    expect(isManagedStudentEvent({ ...base, studentId: "other", studentName: "다른학생" })).toBe(false);
    expect(
      isManagedStudentEvent({ ...base, event: { ...event, description: "표식 없음" }, studentId: "stu1" })
    ).toBe(false);
  });
});

describe("sessionNeedsUpsert", () => {
  it("일정 ID가 없거나, 시간·메모 등이 바뀌면 다시 올려야 한다", () => {
    const synced = { ...session, googleCalendarEventId: "evt1" };
    expect(sessionNeedsUpsert(undefined, session)).toBe(true);
    expect(sessionNeedsUpsert(synced, synced)).toBe(false);
    expect(sessionNeedsUpsert(synced, { ...synced, displayAt: "2026-11-30T10:00:00.000Z" })).toBe(true);
    expect(sessionNeedsUpsert(synced, { ...synced, memo: "준비물" })).toBe(true);
  });
});

describe("동기화 대상 고르기 (runSync에서 분리한 계산)", () => {
  const FUTURE = "2030-01-07T09:00:00.000Z";
  const PAST = "2020-01-06T09:00:00.000Z";
  const s = (id: string, extra: Partial<Session> = {}): Session => ({
    id,
    studentId: "stu1",
    index: 1,
    displayAt: FUTURE,
    state: "normal",
    ...extra,
  });
  const synced = (id: string, extra: Partial<Session> = {}) =>
    s(id, {
      googleCalendarEventId: `evt-${id}`,
      googleCalendarOwnerEmail: "t@example.com",
      googleCalendarStatus: "synced",
      ...extra,
    });
  const studentById = new Map([["stu1", { ...student, teacherId: "t1" }]]);
  const teacherById = new Map([["t1", teacher]]);

  it("selectProvisionalSyncTargets: pending/error는 항상, 변화 없는 synced는 제외, 지난 회차 신규 생성은 제외", () => {
    const prev = [synced("a"), synced("b")];
    const next = [
      synced("a"), // 변화 없음
      synced("b", { googleCalendarStatus: "error" }), // 오류 → 대상
      s("c"), // 새 회차(미래) → 대상
      s("d", { displayAt: PAST }), // 새 회차(과거) → 제외
    ];
    const ids = selectProvisionalSyncTargets(new Map(prev.map((x) => [x.id, x])), next).map((x) => x.id);
    expect(ids).toEqual(["b", "c"]);
  });

  it("selectSyncTargets: 선생님 이메일·영구 Meet 불일치도 다시 올린다", () => {
    const prevList = [synced("a"), synced("b"), synced("c")];
    const next = [
      synced("a"), // 변화 없음 → 제외
      synced("b", { googleCalendarOwnerEmail: "old-teacher@example.com" }), // ownerDrift
      synced("c", { googleMeetUrl: "https://meet.google.com/old" }), // meetDrift (학생 영구 Meet와 다름)
    ];
    const ids = selectSyncTargets({
      visibleNextSessions: next,
      previousById: new Map(prevList.map((x) => [x.id, x])),
      studentById: new Map([["stu1", { ...student, teacherId: "t1", permanentMeetUrl: "https://meet.google.com/perm" }]]),
      teacherById,
    }).map((x) => x.id);
    // a도 Meet 링크가 영구 링크와 달라 meetDrift 대상 → 영구 Meet가 있으면 모든 회차가 맞춰진다
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("selectSyncTargets: 영구 Meet가 없고 아무것도 안 바뀌면 대상이 아니다", () => {
    const prevList = [synced("a")];
    const ids = selectSyncTargets({
      visibleNextSessions: [synced("a")],
      previousById: new Map(prevList.map((x) => [x.id, x])),
      studentById,
      teacherById,
    });
    expect(ids).toEqual([]);
  });

  it("selectRemovedEventsToDelete: 사라졌고, 일정 ID가 있고, 내 담당이고, 앱 캘린더인 것만 지운다", () => {
    const previous = [
      synced("kept"), // 아직 목록에 있음
      s("no-event"), // 일정 없음
      synced("primary", { googleCalendarId: "primary" }), // 기본 캘린더
      synced("gone", { googleCalendarId: "app-cal" }), // ✅ 삭제 대상
    ];
    const pick = (currentEmail: string) =>
      selectRemovedEventsToDelete({
        previous,
        visibleIds: new Set(["kept"]),
        studentById,
        teacherById,
        currentEmail,
      }).map((x) => x.id);
    expect(pick("t@example.com")).toEqual(["gone"]);
    expect(pick("someone-else@example.com")).toEqual([]); // 내 담당이 아니면 안 지움
  });

  it("orderSyncTargets: 시각 순, 같으면 회차 번호 순 (원본 배열은 그대로)", () => {
    const list = [s("x", { index: 2 }), s("y", { displayAt: PAST }), s("z", { index: 1 })];
    expect(orderSyncTargets(list).map((x) => x.id)).toEqual(["y", "z", "x"]);
    expect(list.map((x) => x.id)).toEqual(["x", "y", "z"]);
  });
});
