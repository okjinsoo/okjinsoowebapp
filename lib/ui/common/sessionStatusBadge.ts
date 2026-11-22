import { getStatusStyle } from "@/lib/factories/sessionFactories";
import type { SessionMetaStatus } from "@/lib/types/index";

export function getSessionStatusLabel(status?: SessionMetaStatus): "출석" | "결석" | "예정" {
  if (status === "present") return "출석";
  if (status === "absent") return "결석";
  return "예정";
}

export function getSessionStatusBadge(status?: SessionMetaStatus): {
  label: "출석" | "결석" | "예정";
  style: { background: string; color: string };
} {
  const label = getSessionStatusLabel(status);
  const tone = getStatusStyle(status);
  return {
    label,
    style: { background: tone.bg, color: tone.text },
  };
}
