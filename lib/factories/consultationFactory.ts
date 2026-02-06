import type { ConsultationRecord } from "@/lib/types/index";
import type { ConsultFormState } from "@/lib/ui/common/ConsultModal";

export function normalizeConsultPurpose(purpose: unknown): ConsultationRecord["purpose"] {
  if (purpose === "pause_request" || purpose === "refund_request") return "pause_request";
  if (purpose === "extension") return "extension";
  return "general";
}

export function validateConsultForm(form: ConsultFormState, isAdmin: boolean): string | null {
  if (!form.date) return "날짜를 입력해주세요.";
  if (!form.purpose) return "목적을 선택해주세요.";
  if (!form.target) return "대상을 선택해주세요.";
  if (!form.content.trim()) return "상담 내용을 입력해주세요.";

  if (form.purpose === "extension") {
    if (!form.extensionResult) return "연장 결과를 선택해주세요.";
    if (form.extensionResult === "extended") {
      if (!form.extensionPaymentDate) return "결제일을 입력해주세요.";
      if (!Number.isFinite(form.extensionAddedCount) || form.extensionAddedCount <= 0) {
        return "추가 회차를 1 이상으로 입력해주세요.";
      }
    }
  }

  if (isAdmin && form.finalResult === "pause_confirm" && !form.pauseEffectiveDate) {
    return "마지막 수업일을 입력해주세요.";
  }
  return null;
}

export function buildConsultationRecord(args: {
  records: ConsultationRecord[];
  editingId: string | null;
  form: ConsultFormState;
  nowIso: string;
  makeId: () => string;
}): {
  previous: ConsultationRecord | undefined;
  next: ConsultationRecord;
  updated: ConsultationRecord[];
} {
  const { records, editingId, form, nowIso, makeId } = args;
  const previous = editingId ? records.find((r) => r.id === editingId) : undefined;
  const next: ConsultationRecord = {
    id: editingId ?? makeId(),
    date: form.date,
    purpose: form.purpose,
    target: form.target,
    content: form.content.trim(),
    adminConsultDate: form.purpose === "pause_request" ? form.adminConsultDate || undefined : undefined,
    extensionResult: form.purpose === "extension" ? form.extensionResult || undefined : undefined,
    extensionPaymentDate:
      form.purpose === "extension" && form.extensionResult === "extended" ? form.extensionPaymentDate : undefined,
    extensionAddedCount:
      form.purpose === "extension" && form.extensionResult === "extended"
        ? Math.max(1, Math.floor(Number(form.extensionAddedCount) || 0))
        : undefined,
    extensionPaymentConfirmed:
      form.purpose === "extension" && form.extensionResult === "extended"
        ? Boolean(form.extensionPaymentConfirmed)
        : undefined,
    extensionAppliedAt: previous?.extensionAppliedAt,
    extensionPaymentRecordId: previous?.extensionPaymentRecordId,
    finalNote: form.finalNote.trim() || undefined,
    finalResult: form.finalResult || undefined,
    pauseEffectiveDate: form.finalResult === "pause_confirm" ? form.pauseEffectiveDate : undefined,
    pauseRefundRatio: form.finalResult === "pause_confirm" ? form.pauseRefundRatio || undefined : undefined,
    pauseRefundCompleted: form.finalResult === "pause_confirm" ? Boolean(form.pauseRefundCompleted) : undefined,
    createdAt: nowIso,
  };
  const updated = editingId
    ? records.map((r) => (r.id === editingId ? { ...r, ...next } : r))
    : [...records, next];
  return { previous, next, updated };
}

export function deleteConsultationRecord(records: ConsultationRecord[], editingId: string | null): ConsultationRecord[] {
  if (!editingId) return records;
  return records.filter((r) => r.id !== editingId);
}
