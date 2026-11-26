import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { browserStorage } from "@/lib/storage/browserStorage";
import type { Session, Student } from "@/lib/types/index";

/**
 * 50ms 단기 기억(캐시) 문제 재현 테스트
 *
 * 상황: 서버에서 받은 새 데이터가 loadSessions()/loadStudents()를 거치지 않고
 *       저장소에 직접 적힌 직후(50ms 안)에 다시 읽으면, 옛날 목록이 돌아오면 안 됩니다.
 */

vi.mock("@/lib/storage/sharedSnapshot", () => ({
  STUDENTS_KEY: "tutorweb_students_v1",
  pushSharedSnapshot: vi.fn().mockResolvedValue({ sessionsSynced: true, stateKvSynced: true }),
  readLocalStudents: vi.fn(() => []),
  readLocalTeachers: vi.fn(() => []),
}));

vi.mock("@/lib/auth/roleBindings", () => ({
  syncRoleBindingEmails: vi.fn().mockResolvedValue(undefined),
}));

import { loadSessions } from "@/lib/storage/sessions";
import { loadStudents } from "@/lib/storage/students";

const originalWindow = (globalThis as { window?: unknown }).window;
let fakeNow = Date.UTC(2026, 10, 27, 0, 0, 0);

function session(id: string): Session {
  return { id, studentId: "stu1", index: 1, displayAt: "2026-11-30T09:00:00.000Z", state: "normal" };
}

function student(id: string): Student {
  return {
    id,
    token: `tok-${id}`,
    name: id,
    cohort: "2026_test",
    status: "active",
    startDate: "2026-03-01",
    planCount: 12,
    scheduleRules: [{ weekday: 1, hour: 20, minute: 0 }],
    googleEmail: `${id}@example.com`,
    studentPhone: "01000000000",
    parentPhone: "01000000001",
    school: "테스트중",
    grade: "2",
  };
}

describe("저장소 단기 기억(50ms 캐시) 무효화", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    fakeNow += 60_000; // 이전 테스트의 캐시가 섞이지 않도록 시계를 넘김
    vi.setSystemTime(fakeNow);
    // 실제 브라우저처럼 이벤트를 주고받을 수 있는 window
    (globalThis as { window?: unknown }).window = new EventTarget();
    browserStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
      return;
    }
    (globalThis as { window?: unknown }).window = originalWindow;
  });

  it("회차: 저장소에 직접 새 목록이 적히면 50ms 안이라도 바로 새 목록을 돌려준다", () => {
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify([session("old")]));
    expect(loadSessions().map((s) => s.id)).toEqual(["old"]); // 캐시에 "old" 기억

    // 서버 동기화가 저장소에 직접 적는 상황 (시간은 흐르지 않음)
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify([session("old"), session("new")]));

    expect(loadSessions().map((s) => s.id)).toEqual(["old", "new"]);
  });

  it("학생: 저장소에 직접 새 목록이 적히면 50ms 안이라도 바로 새 목록을 돌려준다", () => {
    browserStorage.setItem("tutorweb_students_v1", JSON.stringify([student("a")]));
    expect(loadStudents().map((s) => s.id)).toEqual(["a"]);

    browserStorage.setItem("tutorweb_students_v1", JSON.stringify([student("a"), student("b")]));

    expect(loadStudents().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("저장소 전체 지우기(clear) 후에도 옛날 목록을 돌려주지 않는다", () => {
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify([session("old")]));
    expect(loadSessions()).toHaveLength(1);

    browserStorage.clear();

    expect(loadSessions()).toEqual([]);
  });

  it("다른 키가 바뀌면 캐시를 유지한다 (속도 이점 유지)", () => {
    browserStorage.setItem("tutorweb_sessions_v1", JSON.stringify([session("old")]));
    const first = loadSessions();

    browserStorage.setItem("some_other_key", "x");

    expect(loadSessions()).toBe(first); // 같은 배열 객체 = 캐시에서 나옴
  });
});
