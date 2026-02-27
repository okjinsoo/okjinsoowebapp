import { getStatusStyle, type SessionState } from "@/lib/factories/sessionFactories";

export function getSessionStatusLabel(status?: SessionState): "출석" | "결석" | "예정" {
  if (status === "present") return "출석";
  if (status === "absent") return "결석";
  return "예정";
}

export function getSessionStatusBadge(status?: SessionState): {
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
