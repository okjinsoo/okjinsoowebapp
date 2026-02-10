// lib/ui/common/roleGateStorage.ts
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";

export type Role = "a" | "t" | "s";

const ROLE_KEY = "tutorweb_current_role_v1";
const STUDENT_KEY = "tutorweb_current_student_token";
export const GATE_EVENT = "tutorweb:gateUpdated";

export function loadCurrentRole(): Role | null {
  if (typeof window === "undefined") return null;
  const v = browserStorage.getItem(ROLE_KEY);
  return v === "a" || v === "t" || v === "s" ? v : null;
}

export function saveCurrentRole(role: Role) {
  if (typeof window === "undefined") return;
  const prev = browserStorage.getItem(ROLE_KEY);
  if (prev === role) return;
  browserStorage.setItem(ROLE_KEY, role);
  dispatchGateUpdated();
}

export function loadCurrentStudentToken(): string | null {
  if (typeof window === "undefined") return null;
  const v = browserStorage.getItem(STUDENT_KEY);
  return v && v.trim() ? v.trim() : null;
}

export function saveCurrentStudentToken(token: string) {
  if (typeof window === "undefined") return;
  const next = token.trim();
  const prev = (browserStorage.getItem(STUDENT_KEY) ?? "").trim();
  if (prev === next) return;
  browserStorage.setItem(STUDENT_KEY, token);
  dispatchGateUpdated();
}

export function clearCurrentStudentToken() {
  if (typeof window === "undefined") return;
  const prev = browserStorage.getItem(STUDENT_KEY);
  if (!prev) return;
  browserStorage.removeItem(STUDENT_KEY);
  dispatchGateUpdated();
}

export function dispatchGateUpdated() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(GATE_EVENT));
}
