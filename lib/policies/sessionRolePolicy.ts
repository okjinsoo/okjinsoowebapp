export type SessionRole = "a" | "t" | "s";
const CONSULT_FEATURES_ENABLED = false;

export function canEditSessionMeta(role: SessionRole): boolean {
  return role !== "s";
}

export function canAssignSessionLectures(role: SessionRole): boolean {
  return role !== "s";
}

export function canSeeSessionInternalFields(role: SessionRole): boolean {
  return role !== "s";
}

export function canUseConsultFeatures(role: SessionRole): boolean {
  return CONSULT_FEATURES_ENABLED && role !== "s";
}

export function canTriggerCalendarSync(role: SessionRole): boolean {
  return role === "a" || role === "t";
}
