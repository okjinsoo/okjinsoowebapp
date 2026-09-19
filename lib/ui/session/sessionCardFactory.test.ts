import { describe, expect, test } from "vitest";
import {
  resolveRulesForIndex,
  resolveDurationMinForSession,
  resolveDurationMinForSessionWithMeta,
  normalizeDurationMin,
} from "./sessionCardFactory";
import type { Student, ScheduleRule, PaymentRecord } from "@/lib/types/index";

describe("sessionCardFactory - 시간표 규칙 및 수업 시간 복원 엔진", () => {
  const createMockStudent = (overrides?: Partial<Student>): Student => ({
    id: "st_1",
    token: "tok_1",
    name: "홍길동",
    cohort: "2026_01",
    status: "active",
    startDate: "2026-03-01",
    planCount: 12,
    googleEmail: "test@gmail.com",
    studentPhone: "01011112222",
    parentPhone: "01033334444",
    school: "테스트고",
    grade: "2",
    scheduleRules: [
      { weekday: 1, hour: 17, minute: 0, durationMin: 120 }, // 월 17:00 (120분)
      { weekday: 3, hour: 17, minute: 30, durationMin: 90 }, // 수 17:30 (90분)
    ],
    ...overrides,
  });

  describe("resolveRulesForIndex", () => {
    test("기본 규칙만 있는 경우 모든 회차에서 기본 규칙 유지", () => {
      const student = createMockStudent();
      const rulesSession1 = resolveRulesForIndex(student, 1);
      const rulesSession8 = resolveRulesForIndex(student, 8);

      expect(rulesSession1).toHaveLength(2);
      expect(rulesSession1[0]).toMatchObject({ weekday: 1, hour: 17, minute: 0, durationMin: 120 });
      expect(rulesSession1[1]).toMatchObject({ weekday: 3, hour: 17, minute: 30, durationMin: 90 });
      expect(rulesSession8).toEqual(rulesSession1);
    });

    test("시간표 변경 이벤트(scheduleChangeEvents)가 지정 회차(startIndex: 5)부터 정확히 적용되는지 검증", () => {
      const student = createMockStudent({
        scheduleChangeEvents: [
          {
            id: "change_1",
            startIndex: 5,
            newRules: [
              { weekday: 2, hour: 19, minute: 30, durationMin: 150 }, // 화 19:30 (150분)
              { weekday: 4, hour: 19, minute: 30, durationMin: 150 }, // 목 19:30 (150분)
            ],
          },
        ],
      });

      // 4회차까지는 기존 규칙 (월/수)
      const rules4 = resolveRulesForIndex(student, 4);
      expect(rules4[0].weekday).toBe(1);
      expect(rules4[1].weekday).toBe(3);

      // 5회차부터는 새 규칙 (화/목, 19:30 시작, 150분)
      const rules5 = resolveRulesForIndex(student, 5);
      expect(rules5).toHaveLength(2);
      expect(rules5[0]).toMatchObject({ weekday: 2, hour: 19, minute: 30, durationMin: 150 });
      expect(rules5[1]).toMatchObject({ weekday: 4, hour: 19, minute: 30, durationMin: 150 });

      // 6회차도 새 규칙 유지
      const rules6 = resolveRulesForIndex(student, 6);
      expect(rules6[0].weekday).toBe(2);
    });

    test("결제 이력(paymentHistory)의 sessionAddRules에서 30분 시작 시간과 수업 시간(durationHour -> durationMin)이 복원되는지 검증", () => {
      const paymentRecord: PaymentRecord = {
        id: "pay_ext_1",
        paymentDate: "2026-04-01",
        addedCount: 4,
        startIndex: 9,
        endIndex: 12,
        sessionAddRules: [
          { weekday: 1, hour: 18, minute: 30, durationHour: 2.5 }, // 150분
          { weekday: 3, hour: 18, minute: 30, durationHour: 3 },   // 180분
        ],
      };

      const student = createMockStudent({
        paymentHistory: [paymentRecord],
      });

      // 8회차는 기존 기본 규칙
      const rules8 = resolveRulesForIndex(student, 8);
      expect(rules8[0].durationMin).toBe(120);

      // 9회차(결제 구간 startIndex: 9)는 sessionAddRules의 30분 및 수업시간 반영
      const rules9 = resolveRulesForIndex(student, 9);
      expect(rules9[0].minute).toBe(30);
      expect(rules9[0].durationMin).toBe(150); // 2.5시간 -> 150분
      expect(rules9[1].minute).toBe(30);
      expect(rules9[1].durationMin).toBe(180); // 3시간 -> 180분

      // 12회차(endIndex: 12)도 반영
      const rules12 = resolveRulesForIndex(student, 12);
      expect(rules12[0].durationMin).toBe(150);
    });
  });

  describe("resolveDurationMinForSessionWithMeta", () => {
    const sampleRules: ScheduleRule[] = [
      { weekday: 1, hour: 16, minute: 0, durationMin: 90 },   // 월 16:00 (90분)
      { weekday: 3, hour: 17, minute: 30, durationMin: 120 }, // 수 17:30 (120분)
      { weekday: 5, hour: 18, minute: 30, durationMin: 150 }, // 금 18:30 (150분)
    ];

    test("개별 회차 오버라이드(overrideDurationMin)가 설정된 경우 최우선 적용", () => {
      // 2026-03-02는 월요일(weekday 1), 원래 규칙은 90분
      const iso = "2026-03-02T16:00:00+09:00";
      const duration = resolveDurationMinForSessionWithMeta(iso, sampleRules, {
        overrideDurationMin: 180, // 보강 등으로 3시간(180분)으로 수동 변경됨
      });

      expect(duration).toBe(180);
    });

    test("요일과 시/분이 정확히 일치하는 경우 해당 규칙의 durationMin 반환", () => {
      // 2026-03-04는 수요일(weekday 3), 17:30 시작 -> 120분 매칭
      const iso = "2026-03-04T17:30:00+09:00";
      const duration = resolveDurationMinForSession(iso, sampleRules);
      expect(duration).toBe(120);

      // 2026-03-06은 금요일(weekday 5), 18:30 시작 -> 150분 매칭
      const isoFri = "2026-03-06T18:30:00+09:00";
      const durationFri = resolveDurationMinForSession(isoFri, sampleRules);
      expect(durationFri).toBe(150);
    });

    test("요일은 일치하나 시작 시간이 부분 변경된 경우에도 요일 규칙 durationMin 지능형 fallback 유지", () => {
      // 2026-03-04 수요일에 시간이 17:30에서 19:00로 임의 변경되었으나 요일은 수요일
      const isoChangedTime = "2026-03-04T19:00:00+09:00";
      const duration = resolveDurationMinForSession(isoChangedTime, sampleRules);
      expect(duration).toBe(120); // 수요일 규칙의 120분 유지
    });

    test("규칙이 없거나 잘못된 ISO 문자열인 경우 안전 기본값 반환", () => {
      expect(resolveDurationMinForSession(null, sampleRules)).toBe(90); // 첫 번째 유효 규칙의 durationMin
      expect(resolveDurationMinForSession("invalid-iso-string", sampleRules)).toBe(90);
      expect(resolveDurationMinForSession("2026-03-02T16:00:00+09:00", [])).toBe(60); // 규칙이 비어있으면 기본 60분
    });

    test("normalizeDurationMin 허용 수업 시간(60, 90, 120, 150, 180) 규격화 검증", () => {
      expect(normalizeDurationMin(60)).toBe(60);
      expect(normalizeDurationMin(90)).toBe(90);
      expect(normalizeDurationMin(120)).toBe(120);
      expect(normalizeDurationMin(150)).toBe(150);
      expect(normalizeDurationMin(180)).toBe(180);
      // 허용 범위 밖의 임의 값은 가장 가까운 유효 범위로 제한
      expect(normalizeDurationMin(45)).toBe(60);
      expect(normalizeDurationMin(240)).toBe(180);
    });
  });
});
