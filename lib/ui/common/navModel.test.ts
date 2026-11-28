import { describe, expect, it } from "vitest";

import { buildCrumbs, isActive, menuFor } from "@/lib/ui/common/navModel";

const names = {
  student: (t: string | null) => (t === "s1" ? "조윤우" : null),
  teacher: (t: string) => (t === "t1" ? "옥진수" : null),
};

describe("appNav", () => {
  it("관리자·선생님 화면에만 메뉴, 지금 메뉴 표시", () => {
    expect(menuFor("/")).toBeNull();
    expect(menuFor("/s/smain")).toBeNull();
    const admin = menuFor("/a/tmain/t1/smain/s1")!;
    expect(admin.filter((m) => isActive(m, "/a/tmain/t1/smain/s1")).map((m) => m.label)).toEqual(["관리자 메인"]);
    expect(menuFor("/t/tmain")!.map((m) => m.label)).toEqual(["내 학생", "강의 저장소"]);
  });

  it("위치: 선생님 › 학생 › 회차, 마지막 칸은 링크 없음", () => {
    expect(buildCrumbs("/a/tmain/t1/smain/s1/session/60", names, null)).toEqual([
      { label: "관리자 메인", href: "/a/amain" },
      { label: "옥진수", href: "/a/tmain/t1" },
      { label: "조윤우", href: "/a/tmain/t1/smain/s1" },
      { label: "60회차" },
    ]);
    expect(buildCrumbs("/t/tmain/s1/edit", names, null)).toEqual([
      { label: "내 학생", href: "/t/tmain" },
      { label: "조윤우", href: "/t/tmain/s1" },
      { label: "정보 수정" },
    ]);
    expect(buildCrumbs("/t/smain/session/3", names, "s1").map((c) => c.label)).toEqual(["내 학생", "조윤우", "3회차"]);
  });

  it("한 칸뿐인 화면은 위치 표시 없음", () => {
    expect(buildCrumbs("/a/amain", names, null)).toEqual([]);
    expect(buildCrumbs("/t/tmain", names, null)).toEqual([]);
    expect(buildCrumbs("/lib/lectures", names, null)).toEqual([]);
  });
});
