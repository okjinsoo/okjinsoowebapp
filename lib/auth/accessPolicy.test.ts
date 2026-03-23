import { describe, expect, test } from "vitest";

import { canAccessRole, requiredRoleByPathname } from "@/lib/auth/accessPolicy";

describe("accessPolicy", () => {
  test("경로별 필요 권한을 일관되게 계산한다", () => {
    expect(requiredRoleByPathname("/a/amain")).toBe("admin");
    expect(requiredRoleByPathname("/t/tmain")).toBe("teacher");
    expect(requiredRoleByPathname("/s/smain")).toBe("student");
    expect(requiredRoleByPathname("/")).toBeNull();
  });

  test("역할별 접근 규칙을 일관되게 유지한다", () => {
    expect(canAccessRole("admin", "admin")).toBe(true);
    expect(canAccessRole("teacher", "admin")).toBe(false);
    expect(canAccessRole("teacher", "teacher")).toBe(true);
    expect(canAccessRole("student", "teacher")).toBe(false);
    expect(canAccessRole("student", "student")).toBe(true);
    expect(canAccessRole("teacher", "student")).toBe(true);
    expect(canAccessRole("guest", "student")).toBe(false);
  });
});
