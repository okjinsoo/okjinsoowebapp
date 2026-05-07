export type SessionRole = "a" | "t" | "s";

export function canEditSessionMeta(role: SessionRole): boolean {
  return role !== "s";
}

export function canAssignSessionLectures(role: SessionRole): boolean {
  return role !== "s";
}

export function canSeeSessionInternalFields(role: SessionRole): boolean {
  return role !== "s";
}

export function canTriggerCalendarSync(role: SessionRole): boolean {
  return role === "a" || role === "t";
}
