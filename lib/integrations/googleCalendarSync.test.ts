import { describe, it, expect } from "vitest";
import { resolveDurationMinForSessionWithMeta, resolveRulesForIndex } from "@/lib/factories/sessionScheduleResolver";
import { getEffectiveMetaMap, parseMetaMapFromRaw } from "@/lib/ui/session/sessionEffective";
import {
  isGoogleRateLimitError,
  partitionSyncTargetsForMeetSafety,
  runWithConcurrencyLimit,
} from "@/lib/integrations/googleCalendarSync";
import type { Session, Student } from "@/lib/types/index";

describe("Google Calendar 동기화 시간 및 수업 길이 계산 검증", () => {
  const mockStudent: Student = {
    id: "st_1",
    token: "token_123",
    name: "홍길동",
    cohort: "2026_01",
    status: "active",
    startDate: "2026-09-01",
    planCount: 12,
    googleEmail: "student@test.com",
    studentPhone: "01011112222",
    parentPhone: "01033334444",
    school: "테스트고",
    grade: "10",
    scheduleRules: [
      { weekday: 2, hour: 17, minute: 0, durationMin: 90 }, // 화 17:00 (1시간 30분)
      { weekday: 4, hour: 19, minute: 30, durationMin: 150 }, // 목 19:30 (2시간 30분)
    ],
    scheduleChangeEvents: [
      {
        id: "chg_1",
        startIndex: 5,
        newRules: [
          { weekday: 2, hour: 18, minute: 0, durationMin: 120 }, // 5회차부터 화 18:00 (2시간)
        ],
      },
    ],
  };

  it("1~4회차는 기본 규칙(90분, 150분) durationMin이 정확히 산출되어야 한다", () => {
    const rules1 = resolveRulesForIndex(mockStudent, 1);
    expect(rules1).toHaveLength(2);

    // 2026-09-01T08:00:00.000Z = KST 17:00 (화요일)
    const dur1 = resolveDurationMinForSessionWithMeta("2026-09-01T08:00:00.000Z", rules1, undefined);
    expect(dur1).toBe(90);

    // 2026-09-03T10:30:00.000Z = KST 19:30 (목요일)
    const dur2 = resolveDurationMinForSessionWithMeta("2026-09-03T10:30:00.000Z", rules1, undefined);
    expect(dur2).toBe(150);
  });

  it("5회차 이후는 변경된 규칙(120분) durationMin이 정확히 산출되어야 한다", () => {
    const rules5 = resolveRulesForIndex(mockStudent, 5);
    expect(rules5).toHaveLength(1);
    expect(rules5[0].durationMin).toBe(120);

    const dur5 = resolveDurationMinForSessionWithMeta("2026-09-15T09:00:00.000Z", rules5, undefined);
    expect(dur5).toBe(120);
  });

  it("개별 회차에 overrideDurationMin이 있으면 최우선으로 반영되어야 한다", () => {
    const rules1 = resolveRulesForIndex(mockStudent, 1);
    const meta = { overrideDurationMin: 180 }; // 3시간
    const dur = resolveDurationMinForSessionWithMeta("2026-09-01T08:00:00.000Z", rules1, meta);
    expect(dur).toBe(180);
  });

  it("서버 stateKv의 raw 메타맵을 정상적으로 파싱하고 병합해야 한다", () => {
    const raw = JSON.stringify({
      1: { status: "present", overrideDate: "2026-09-02", overrideHour: 15, overrideMinute: 0, overrideDurationMin: 120 },
      2: { carry: 1 },
    });
    const parsed = parseMetaMapFromRaw(raw);
    expect(parsed[1].overrideDate).toBe("2026-09-02");
    expect(parsed[1].overrideDurationMin).toBe(120);
    expect(parsed[2].carry).toBe(1);

    const effective = getEffectiveMetaMap({
      token: "token_123",
      stateKv: {
        "tutorweb_metaMap_v1:token_123": raw,
      },
    });
    expect(effective[1].overrideDurationMin).toBe(120);
  });

  it("C단계: 영구 Meet 링크가 없는 학생은 첫 회차만 직렬 seed로 분리하고 나머지는 병렬 대상으로 분류한다", () => {
    const stuWithoutMeet: Student = { ...mockStudent, id: "st_no_meet", permanentMeetUrl: undefined };
    const stuWithMeet: Student = {
      ...mockStudent,
      id: "st_has_meet",
      permanentMeetUrl: "https://meet.google.com/aaa-bbbb-ccc",
    };
    const studentById = new Map<string, Student>([
      [stuWithoutMeet.id, stuWithoutMeet],
      [stuWithMeet.id, stuWithMeet],
    ]);

    const targets: Session[] = [
      { id: "a1", studentId: "st_no_meet", index: 1, displayAt: "2026-09-01T08:00:00.000Z", state: "normal" },
      { id: "a2", studentId: "st_no_meet", index: 2, displayAt: "2026-09-03T08:00:00.000Z", state: "normal" },
      { id: "b1", studentId: "st_has_meet", index: 1, displayAt: "2026-09-01T09:00:00.000Z", state: "normal" },
      { id: "b2", studentId: "st_has_meet", index: 2, displayAt: "2026-09-03T09:00:00.000Z", state: "normal" },
    ];

    const { seedTargets, parallelTargets } = partitionSyncTargetsForMeetSafety(targets, studentById);
    expect(seedTargets.map((s) => s.id)).toEqual(["a1"]);
    expect(parallelTargets.map((s) => s.id)).toEqual(["a2", "b1", "b2"]);
  });

  it("C단계: runWithConcurrencyLimit은 지정된 최대 동시 실행 수(limit)를 초과하지 않고 모든 항목을 처리한다", async () => {
    let active = 0;
    let peakActive = 0;
    const done: number[] = [];

    await runWithConcurrencyLimit([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      await new Promise((r) => setTimeout(r, 5));
      done.push(item);
      active -= 1;
    });

    expect(peakActive).toBeLessThanOrEqual(3);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("C단계: 구글 API 속도 제한(429 및 403 rateLimitExceeded)을 정확히 판별한다", () => {
    expect(isGoogleRateLimitError(429, "Too Many Requests")).toBe(true);
    expect(isGoogleRateLimitError(403, "User Rate Limit Exceeded (userRateLimitExceeded)")).toBe(true);
    expect(isGoogleRateLimitError(403, "Insufficient Permission")).toBe(false);
    expect(isGoogleRateLimitError(404, "Not Found")).toBe(false);
  });
});
