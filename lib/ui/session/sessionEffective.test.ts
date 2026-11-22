import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Student } from "@/lib/types/index";
import { browserStorage } from "@/lib/storage/browserStorage";
import { ymdFromISO_KST } from "@/lib/utils/date";
import {
  buildBadges,
  buildBaseDatesISO,
  buildUpdatedMetaMap,
  computeEffectiveISO,
  getEffectiveMetaMap,
  getStatusStyle,
  metaMapKey,
  parseMetaMapFromRaw,
  resolveActiveScheduleRules,
  ymdFromISO_KST as ymdFromISO_KST_effective,
} from "@/lib/ui/session/sessionEffective";

function sampleStudent(): Student {
  return {
    id: "stu-1",
    token: "tok-1",
    name: "테스트학생",
    cohort: "2026_demo",
    status: "active",
    startDate: "2026-02-09",
    planCount: 20,
    scheduleRules: [
      { weekday: 1, hour: 20, minute: 0 }, // 월
      { weekday: 3, hour: 20, minute: 0 }, // 수
    ],
    googleEmail: "test@example.com",
    studentPhone: "01000000000",
    parentPhone: "01000000001",
    school: "테스트중",
    grade: "2",
    scheduleChangeEvents: [
      {
        id: "chg-1",
        startIndex: 5,
        startDate: "2026-03-08",
        newRules: [
          { weekday: 2, hour: 20, minute: 0 }, // 화
          { weekday: 4, hour: 20, minute: 0 }, // 목
          { weekday: 5, hour: 20, minute: 0 }, // 금
        ],
      },
    ],
  };
}

describe("sessionEffective schedule change by date", () => {
  beforeEach(() => {
    browserStorage.clear();
  });

  afterEach(() => {
    browserStorage.clear();
  });

  it("keeps earlier sessions and applies new timetable from selected start date", () => {
    const student = sampleStudent();

    // 이월 +2 (3회차), 이월 +2 (5회차)
    browserStorage.setItem(
      metaMapKey(student.token),
      JSON.stringify({
        3: { carry: 2 },
        5: { carry: 2 },
      })
    );

    const baseDatesISO = buildBaseDatesISO(student, 60);
    const metaMap = {
      3: { carry: 2 },
      5: { carry: 2 },
    };

    const ymdOf = (index: number) =>
      ymdFromISO_KST(
        computeEffectiveISO({
          token: student.token,
          index,
          baseDatesISO,
          metaMap,
        }).effectiveISO
      );

    expect(ymdOf(3)).toBe("2026-02-23");
    expect(ymdOf(4)).toBe("2026-02-25");
    expect(ymdOf(5)).toBe("2026-03-13");
    expect(ymdOf(6)).toBe("2026-03-17");
    expect(ymdOf(7)).toBe("2026-03-19");
  });

  it("carry+1 bypasses extension override and uses baseDatesISO slot (no schedule change)", () => {
    // 순수 수/토 스케줄 (시간 변경 없음) - carry가 extension override를 건너뛰는지 검증
    const student: Student = {
      id: "stu-carry",
      token: "tok-carry",
      name: "이월테스트",
      cohort: "2026_carry",
      status: "active",
      startDate: "2026-03-11", // 2026-03-11 = 수요일
      planCount: 10,
      scheduleRules: [
        { weekday: 3, hour: 23, minute: 0 }, // 수 23:00
        { weekday: 6, hour: 23, minute: 0 }, // 토 23:00
      ],
      googleEmail: "carry@example.com",
      studentPhone: "01000000000",
      parentPhone: "01000000001",
      school: "테스트중",
      grade: "2",
    };

    // 결제 시 자동 생성된 extension override (정상 날짜이지만 extension)
    // baseDatesISO[0]=3월11일수, [1]=3월14일토, [2]=3월18일수, [3]=3월21일토, [4]=3월25일수
    const metaMapNoCarry = {
      1: { overrideDate: "2026-03-11", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
      2: { overrideDate: "2026-03-14", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
      3: { overrideDate: "2026-03-18", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
      4: { overrideDate: "2026-03-21", overrideHour: 23, overrideMinute: 0, overrideSource: "extension" as const, carry: 0 },
    };

    // 이월 없을 때: extension override 그대로 사용 (carry=0)
    {
      browserStorage.setItem(metaMapKey(student.token), JSON.stringify(metaMapNoCarry));
      const baseDatesISO = buildBaseDatesISO(student, 60);
      const ymdOf = (index: number) =>
        ymdFromISO_KST(computeEffectiveISO({ token: student.token, index, baseDatesISO, metaMap: metaMapNoCarry }).effectiveISO);
      expect(ymdOf(1)).toBe("2026-03-11"); // extension override 반영 ✅
      expect(ymdOf(2)).toBe("2026-03-14"); // extension override 반영 ✅
    }

    // 1회차에 이월 +1 적용: skip=1 → extension override 무시하고 baseDatesISO[N] 사용
    const metaMapWithCarry = {
      ...metaMapNoCarry,
      1: { ...metaMapNoCarry[1], carry: 1 },
    };
    browserStorage.setItem(metaMapKey(student.token), JSON.stringify(metaMapWithCarry));
    const baseDatesISO = buildBaseDatesISO(student, 60);
    const ymdOf = (index: number) =>
      ymdFromISO_KST(computeEffectiveISO({ token: student.token, index, baseDatesISO, metaMap: metaMapWithCarry }).effectiveISO);

    // 1회차 carry=1: skip=1, baseIdx=1 → baseDatesISO[1] = 3월14일토
    expect(ymdOf(1)).toBe("2026-03-14"); // 土 (extension 무시, carry 반영)
    // 2회차: skip=1, baseIdx=2 → baseDatesISO[2] = 3월18일수
    expect(ymdOf(2)).toBe("2026-03-18"); // 水
    // 3회차: skip=1, baseIdx=3 → baseDatesISO[3] = 3월21일토
    expect(ymdOf(3)).toBe("2026-03-21"); // 土
  });

  it("회차 추가 후 중간 회차(5회차)에서 시간표를 변경했을 때, 새로 추가된 회차(13~24회차)까지 변경된 시간표가 정상 전파되는지 검증", () => {
    // 12회차 학생 (월/수 20:00)
    // 13~24회차(12회) 회차 추가: paymentHistory에 등록 (sessionAddStartDate: 2026-04-01)
    // 5회차부터 시간표 변경: 화/목 19:00 (startDate: 2026-03-03)
    const student: Student = {
      id: "stu-extend-chg",
      token: "tok-extend-chg",
      name: "시간변경전파테스트",
      cohort: "2026_demo",
      status: "active",
      startDate: "2026-02-09", // 2026-02-09 = 월요일
      planCount: 24,
      googleEmail: "test@example.com",
      studentPhone: "01000000000",
      parentPhone: "01000000001",
      school: "테스트중",
      grade: "2",
      scheduleRules: [
        { weekday: 1, hour: 20, minute: 0 }, // 월 20:00
        { weekday: 3, hour: 20, minute: 0 }, // 수 20:00
      ],
      paymentHistory: [
        {
          id: "pay_1",
          paymentDate: "2026-04-01",
          addedCount: 12,
          startIndex: 13,
          endIndex: 24,
          sessionAddStartDate: "2026-04-01",
        },
      ],
      scheduleChangeEvents: [
        {
          id: "chg_5",
          startIndex: 5,
          startDate: "2026-03-03", // 2026-03-03 = 화요일
          newRules: [
            { weekday: 2, hour: 19, minute: 0 }, // 화 19:00
            { weekday: 4, hour: 19, minute: 0 }, // 목 19:00
          ],
        },
      ],
    };

    const baseDatesISO = buildBaseDatesISO(student, 60);
    const metaMap = {};

    const getIsoAndYmd = (index: number) => {
      const iso = computeEffectiveISO({
        token: student.token,
        index,
        baseDatesISO,
        metaMap,
      }).effectiveISO;
      const ymd = ymdFromISO_KST(iso ?? "");
      return { iso, ymd };
    };

    // 1~4회차: 기존 월/수 (2026-02-09 월, 2026-02-11 수, 2026-02-16 월, 2026-02-18 수)
    expect(getIsoAndYmd(1).ymd).toBe("2026-02-09");
    expect(getIsoAndYmd(2).ymd).toBe("2026-02-11");
    expect(getIsoAndYmd(3).ymd).toBe("2026-02-16");
    expect(getIsoAndYmd(4).ymd).toBe("2026-02-18");

    // 5회차부터: 변경된 화/목 (2026-03-03 화요일부터)
    expect(getIsoAndYmd(5).ymd).toBe("2026-03-03"); // 화
    expect(getIsoAndYmd(6).ymd).toBe("2026-03-05"); // 목

    // 핵심 검증: 13회차 이후(새로 추가된 회차)도 화/목 시간표가 그대로 전파됨!
    // 2026-04-01(수) 이후 첫 화/목은 2026-04-02(목)
    expect(getIsoAndYmd(13).ymd).toBe("2026-04-02"); // 목
    expect(getIsoAndYmd(14).ymd).toBe("2026-04-07"); // 화
    expect(getIsoAndYmd(15).ymd).toBe("2026-04-09"); // 목
  });

  it("사용자 시나리오 검증: 5회차부터 17일(화) 화목 시간표로 변경 시, 4회차(12일 목) 익일인 13일(금)부터 새 시간표로 전환", () => {
    // 기존) 월목 시간표:
    // 2026-02-02(월) 시작:
    // 1회차: 02-02(월), 2회차: 02-05(목), 3회차: 02-09(월), 4회차: 02-12(목)
    // 5회차: 02-16(월) 예정이었음
    //
    // 변경) 시작 날짜: 2026-02-17(화), 시작 회차: 5회차, 변경 시간: 화목
    const student: Student = {
      id: "stu-sim",
      token: "tok-sim",
      name: "시뮬레이션학생",
      cohort: "2026_demo",
      status: "active",
      startDate: "2026-02-02", // 2026-02-02 = 월요일
      planCount: 12,
      googleEmail: "sim@example.com",
      studentPhone: "01011112222",
      parentPhone: "01033334444",
      school: "테스트학교",
      grade: "1",
      scheduleRules: [
        { weekday: 1, hour: 17, minute: 0 }, // 월 17:00
        { weekday: 4, hour: 17, minute: 0 }, // 목 17:00
      ],
      scheduleChangeEvents: [
        {
          id: "chg-sim-5",
          startIndex: 5,
          startDate: "2026-02-17", // 2026-02-17 = 화요일
          newRules: [
            { weekday: 2, hour: 19, minute: 0 }, // 화 19:00
            { weekday: 4, hour: 19, minute: 0 }, // 목 19:00
          ],
        },
      ],
    };

    const baseDatesISO = buildBaseDatesISO(student, 30);
    const metaMap = {};

    const getYmd = (index: number) => {
      const iso = computeEffectiveISO({ token: student.token, index, baseDatesISO, metaMap }).effectiveISO;
      return ymdFromISO_KST(iso ?? "");
    };

    // 1. 회차별 날짜 검증
    // 1~4회차: 기존 월/목
    expect(getYmd(1)).toBe("2026-02-02"); // 월
    expect(getYmd(2)).toBe("2026-02-05"); // 목
    expect(getYmd(3)).toBe("2026-02-09"); // 월
    expect(getYmd(4)).toBe("2026-02-12"); // 목 (기존 시간표 마지막 수업일!)

    // 5회차부터: 변경된 화/목 (2026-02-17 화요일부터)
    expect(getYmd(5)).toBe("2026-02-17"); // 화
    expect(getYmd(6)).toBe("2026-02-19"); // 목

    // 2. 상단 '수업 시간' 텍스트 전환 시점 검증 (resolveActiveScheduleRules)
    // 4회차 수업 당일(2026-02-12 목): 기존 시간표(월/목) 유지
    const rulesOn4thDay = resolveActiveScheduleRules({ student, targetYmd: "2026-02-12", baseDatesISO, metaMap });
    expect(rulesOn4thDay).toEqual(student.scheduleRules); // 월/목

    // 4회차 다음날(2026-02-13 금): 새로운 시간표(화/목)로 자동 전환!
    const rulesOnNextDay = resolveActiveScheduleRules({ student, targetYmd: "2026-02-13", baseDatesISO, metaMap });
    expect(rulesOnNextDay).toEqual([
      { weekday: 2, hour: 19, minute: 0 },
      { weekday: 4, hour: 19, minute: 0 },
    ]); // 화/목

    // 5회차 수업 시작일(2026-02-17 화): 새로운 시간표(화/목) 유지
    const rulesOn5thDay = resolveActiveScheduleRules({ student, targetYmd: "2026-02-17", baseDatesISO, metaMap });
    expect(rulesOn5thDay).toEqual([
      { weekday: 2, hour: 19, minute: 0 },
      { weekday: 4, hour: 19, minute: 0 },
    ]); // 화/목
  });

  // --- 2-b-1 동작 고정 테스트 (순수 계산 분리 전 안전망) ---

  it("parseMetaMapFromRaw: 유효하지 않은 키·범위 밖 시간/분/수업길이·알 수 없는 상태를 안전하게 정규화한다", () => {
    expect(parseMetaMapFromRaw(null)).toEqual({});
    expect(parseMetaMapFromRaw("")).toEqual({});
    expect(parseMetaMapFromRaw("{broken-json")).toEqual({});

    const parsed = parseMetaMapFromRaw(
      JSON.stringify({
        1: {
          status: "present",
          carry: 2.9,
          overrideDate: "2026-03-10",
          overrideHour: 18,
          overrideMinute: 30,
          overrideDurationMin: 90,
          overrideSource: "manual",
          reason: "보강",
          record: "메모",
        },
        2: {
          status: "invalid_status",
          carry: -3,
          overrideDate: 12345,
          overrideHour: 25,
          overrideMinute: 75,
          overrideDurationMin: 0,
          overrideSource: "unknown",
          reason: null,
          record: undefined,
        },
        notANumber: { status: "absent" },
      })
    );

    expect(Object.keys(parsed)).toEqual(["1", "2"]);
    expect(parsed[1]).toEqual({
      status: "present",
      carry: 2,
      overrideDate: "2026-03-10",
      overrideHour: 18,
      overrideMinute: 30,
      overrideDurationMin: 90,
      overrideSource: "manual",
      reason: "보강",
      record: "메모",
    });
    expect(parsed[2]).toEqual({
      status: undefined,
      carry: 0,
      overrideDate: "",
      overrideHour: null,
      overrideMinute: null,
      overrideDurationMin: null,
      overrideSource: "",
      reason: "",
      record: "",
    });
  });

  it("buildUpdatedMetaMap: 기존 로컬 meta를 유지하면서 patch를 정규화해 반환하고 storage는 직접 쓰지 않는다", () => {
    const token = "tok-update";
    browserStorage.setItem(
      metaMapKey(token),
      JSON.stringify({
        1: { status: "present", reason: "기존사유" },
        2: { carry: 1, reason: "2회차유지" },
      })
    );

    const res = buildUpdatedMetaMap(token, 1, {
      overrideDate: "2026-03-15",
      overrideHour: 19,
      overrideMinute: 30,
      overrideDurationMin: -10,
      overrideSource: "manual",
    });

    expect(res.key).toBe(metaMapKey(token));
    expect(res.nextMeta).toEqual({
      status: "present",
      carry: 0,
      overrideDate: "2026-03-15",
      overrideHour: 19,
      overrideMinute: 30,
      overrideDurationMin: null,
      overrideSource: "manual",
      reason: "기존사유",
      record: "",
    });
    expect(res.nextMetaMap[2]?.reason).toBe("2회차유지");
    expect(JSON.parse(res.raw)[1].overrideDate).toBe("2026-03-15");
    // buildUpdatedMetaMap 자체는 storage를 덮어쓰지 않는다
    expect(JSON.parse(browserStorage.getItem(metaMapKey(token)) ?? "{}")[1].overrideDate).toBeUndefined();
  });

  it("getEffectiveMetaMap: 서버 stateKv를 기반으로 하되 로컬 metaMap 오버라이드를 우선 병합한다", () => {
    const token = "tok-merge";
    const key = metaMapKey(token);
    browserStorage.setItem(
      key,
      JSON.stringify({
        2: { status: "absent", reason: "로컬변경" },
      })
    );

    const merged = getEffectiveMetaMap({
      token,
      stateKv: {
        [key]: JSON.stringify({
          1: { status: "present", reason: "서버전용" },
          2: { status: "planned", reason: "서버옛값" },
        }),
      },
    });

    expect(merged[1]?.status).toBe("present");
    expect(merged[1]?.reason).toBe("서버전용");
    expect(merged[2]?.status).toBe("absent");
    expect(merged[2]?.reason).toBe("로컬변경");
    expect(getEffectiveMetaMap({ token: "" })).toEqual({});
  });

  it("computeEffectiveISO: manual override는 carry/날짜 불일치와 무관하게 최우선이며, extension은 날짜 불일치 시 무시된다", () => {
    const baseDatesISO = [
      "2026-03-02T08:00:00.000Z", // 2026-03-02 17:00 KST
      "2026-03-04T08:00:00.000Z", // 2026-03-04 17:00 KST
      "2026-03-09T08:00:00.000Z", // 2026-03-09 17:00 KST
    ];

    // 1) manual override는 carry=1이어도 최우선 적용 (30분 단위 KST -> UTC)
    const manualRes = computeEffectiveISO({
      token: "tok-ov",
      index: 1,
      baseDatesISO,
      metaMap: {
        1: {
          carry: 1,
          overrideDate: "2026-03-20",
          overrideHour: 19,
          overrideMinute: 30,
          overrideSource: "manual",
        },
      },
    });
    expect(manualRes.effectiveISO).toBe("2026-03-20T10:30:00.000Z");
    expect(manualRes.baseISO).toBe("2026-03-04T08:00:00.000Z");

    // 2) extension override는 carry=0이라도 baseISO 날짜와 다르면 무시되고 baseISO 사용
    const extMismatch = computeEffectiveISO({
      token: "tok-ov",
      index: 1,
      baseDatesISO,
      metaMap: {
        1: {
          carry: 0,
          overrideDate: "2026-03-05",
          overrideHour: 17,
          overrideMinute: 0,
          overrideSource: "extension",
        },
      },
    });
    expect(extMismatch.effectiveISO).toBe("2026-03-02T08:00:00.000Z");
  });

  it("computeEffectiveISO: baseDatesISO 범위를 초과하면 마지막 간격(또는 7일 기본)으로 외삽한다", () => {
    // 마지막 두 날짜 간격: 5일
    const twoDates = [
      "2026-03-02T08:00:00.000Z",
      "2026-03-07T08:00:00.000Z",
    ];
    const extrapolated = computeEffectiveISO({
      token: "tok-extrap",
      index: 3,
      baseDatesISO: twoDates,
      metaMap: {},
    });
    expect(extrapolated.effectiveISO).toBe("2026-03-12T08:00:00.000Z");

    // 1개만 있으면 기본 7일 간격
    const singleFallback = computeEffectiveISO({
      token: "tok-extrap",
      index: 2,
      baseDatesISO: ["2026-03-02T08:00:00.000Z"],
      metaMap: {},
    });
    expect(singleFallback.effectiveISO).toBe("2026-03-09T08:00:00.000Z");

    // 비어있으면 null
    const emptyRes = computeEffectiveISO({
      token: "tok-extrap",
      index: 1,
      baseDatesISO: [],
      metaMap: {},
    });
    expect(emptyRes.effectiveISO).toBeNull();
  });

  it("buildBadges & getStatusStyle: 출결은 배지에서 제외하고 manual 변경·이월만 배지로 노출한다", () => {
    expect(buildBadges({ status: "present" })).toEqual([]);
    expect(buildBadges({ status: "absent", carry: 2 })).toEqual(["이월+2"]);
    expect(buildBadges({ overrideDate: "2026-03-10", overrideSource: "extension" })).toEqual([]);
    expect(buildBadges({ overrideDate: "2026-03-10", overrideSource: "manual", carry: 1 })).toEqual([
      "이월+1",
      "변경",
    ]);

    expect(getStatusStyle("present").bg).toBe("#2563eb");
    expect(getStatusStyle("absent").bg).toBe("#dc2626");
    expect(getStatusStyle("planned").bg).toBe("#64748b");
    expect(getStatusStyle(undefined).bg).toBe("#64748b");
  });

  it("resolveActiveScheduleRules: startIndex<=1 시작일 분기 및 정렬되지 않은 다중 변경 이벤트를 올바르게 처리한다", () => {
    const student: Student = {
      ...sampleStudent(),
      scheduleChangeEvents: [
        {
          id: "chg-5",
          startIndex: 5,
          startDate: "2026-03-08",
          newRules: [{ weekday: 5, hour: 18, minute: 0 }],
        },
        {
          id: "chg-1",
          startIndex: 1,
          startDate: "2026-02-10",
          newRules: [{ weekday: 2, hour: 19, minute: 0 }],
        },
      ],
    };

    // startIndex=1 시작일 이전(2026-02-09)에는 기본 규칙 유지
    expect(resolveActiveScheduleRules({ student, targetYmd: "2026-02-09", metaMap: {} })).toEqual(
      student.scheduleRules
    );
    // startIndex=1 시작일 당일(2026-02-10)부터 chg-1 규칙 적용
    expect(resolveActiveScheduleRules({ student, targetYmd: "2026-02-10", metaMap: {} })).toEqual([
      { weekday: 2, hour: 19, minute: 0 },
    ]);
    // null 학생 안전 반환
    expect(resolveActiveScheduleRules({ student: null })).toEqual([]);
  });

  it("buildBaseDatesISO: metaMapOverride를 전달하면 browserStorage 없이도 동일한 결과를 산출한다", () => {
    const student = sampleStudent();
    const overrideMeta = { 3: { carry: 2 }, 5: { carry: 2 } };
    // browserStorage는 완전히 비어있는 상태
    const baseDatesISO = buildBaseDatesISO(student, 60, overrideMeta);

    const ymd5 = ymdFromISO_KST_effective(
      computeEffectiveISO({
        token: student.token,
        index: 5,
        baseDatesISO,
        metaMap: overrideMeta,
      }).effectiveISO ?? ""
    );
    expect(ymd5).toBe("2026-03-13");
  });

  it("ymdFromISO_KST: UTC 심야 시각이 KST 다음 날로 정확히 변환되고 비정상 ISO는 null 반환한다", () => {
    // 2026-03-01 16:00 UTC === 2026-03-02 01:00 KST
    expect(ymdFromISO_KST_effective("2026-03-01T16:00:00.000Z")).toBe("2026-03-02");
    expect(ymdFromISO_KST_effective("not-a-date")).toBeNull();
  });
});
