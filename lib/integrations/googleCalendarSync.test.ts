import { describe, it, expect } from "vitest";
import { resolveDurationMinForSessionWithMeta, resolveRulesForIndex } from "@/lib/ui/session/sessionCardFactory";
import { getEffectiveMetaMap, parseMetaMapFromRaw } from "@/lib/ui/session/sessionEffective";
import type { Student } from "@/lib/types/index";

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
});
