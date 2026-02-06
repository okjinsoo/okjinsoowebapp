import { describe, expect, test } from "vitest";
import { buildConsultationMap, pickPrimaryConsultTag, type ConsultTag } from "@/lib/ui/session/consultationMap";
import type { ConsultationRecord, Session } from "@/lib/types/index";

function makeSessions(): Session[] {
  return [
    { id: "s1", studentId: "st1", index: 1, displayAt: "2026-02-10T16:00:00+09:00", state: "normal" },
    { id: "s2", studentId: "st1", index: 2, displayAt: "2026-02-11T16:00:00+09:00", state: "normal" },
    { id: "s3", studentId: "st1", index: 3, displayAt: "2026-02-12T16:00:00+09:00", state: "normal" },
    { id: "s4", studentId: "st1", index: 4, displayAt: "2026-02-13T16:00:00+09:00", state: "normal" },
  ];
}

describe("consultationMap", () => {
  test("목적/결과에 맞는 배지 라벨 생성", () => {
    const records: ConsultationRecord[] = [
      {
        id: "c1",
        date: "2026-02-10",
        purpose: "general",
        target: "student",
        content: "일반 상담",
      },
      {
        id: "c2",
        date: "2026-02-11",
        purpose: "pause_request",
        target: "parent",
        content: "휴회 요청",
        finalResult: "pause_confirm",
      },
      {
        id: "c3",
        date: "2026-02-12",
        purpose: "extension",
        target: "student",
        content: "연장 상담",
        extensionResult: "extended",
        extensionPaymentConfirmed: true,
      },
      {
        id: "c4",
        date: "2026-02-13",
        purpose: "extension",
        target: "student",
        content: "연장 상담",
        extensionResult: "not_extended",
      },
    ];

    const sessions = makeSessions();
    const map = buildConsultationMap({
      token: "tok",
      sessions,
      records,
      baseDatesISO: sessions.map((s) => s.displayAt),
      metaMap: {},
    });

    expect(map[1][0].label).toBe("일반 상담");
    expect(map[2][0].label).toBe("휴회 예정");
    expect(map[3][0].label).toBe("연장");
    expect(map[4][0].label).toBe("미연장");
  });

  test("상담일에 정확한 회차가 없으면 가까운 미래(없으면 과거) 회차에 매핑", () => {
    const records: ConsultationRecord[] = [
      {
        id: "cf",
        date: "2026-02-09", // 미래 첫 수업(1회차)로
        purpose: "general",
        target: "student",
        content: "일반 상담",
      },
      {
        id: "cp",
        date: "2026-02-20", // 미래 없음 -> 과거 마지막(4회차)로
        purpose: "pause_request",
        target: "student",
        content: "휴회 요청",
      },
    ];

    const sessions = makeSessions();
    const map = buildConsultationMap({
      token: "tok",
      sessions,
      records,
      baseDatesISO: sessions.map((s) => s.displayAt),
      metaMap: {},
    });

    expect(map[1][0].recordId).toBe("cf");
    expect(map[4][0].recordId).toBe("cp");
  });

  test("동일 회차에서 우선순위 선택: 휴회요청 > 연장 > 일반", () => {
    const tags: ConsultTag[] = [
      {
        purpose: "general",
        target: "student",
        label: "일반 상담",
        badgeClassName: "",
        buttonClassName: "",
        recordId: "1",
      },
      {
        purpose: "extension",
        target: "student",
        label: "연장 요청",
        badgeClassName: "",
        buttonClassName: "",
        recordId: "2",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
      {
        purpose: "pause_request",
        target: "student",
        label: "휴회 요청",
        badgeClassName: "",
        buttonClassName: "",
        recordId: "3",
      },
    ];

    expect(pickPrimaryConsultTag(tags)?.recordId).toBe("3");
  });
});
