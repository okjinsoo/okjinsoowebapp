// v1/lib/factories/lessonStatusFactory.ts
// 수업 현황(기본+연장) 및 환불 계산 공장
import type { PaymentRecord, Student } from "@/lib/types/index";

export type DisplayRecord = PaymentRecord & { isBase?: boolean };
export type RefundRatio = Exclude<PaymentRecord["refundRatio"], undefined>;

function formatYmdDot(ymd?: string): string {
  if (!ymd) return "-";
  return ymd.replace(/-/g, ".");
}

export function computeBaseCount(student: Student | null, history: PaymentRecord[]): number {
  const total = student?.planCount ?? 0;
  const addedSum = history.reduce((sum, h) => sum + Math.max(0, Math.floor(Number(h.addedCount) || 0)), 0);
  return Math.max(0, total - addedSum);
}

export function getBasePaymentDate(student: Student | null): string {
  if (!student) return "-";
  if (student.startDate) return formatYmdDot(student.startDate);
  const created = student.createdAt?.slice(0, 10);
  return created ? formatYmdDot(created) : "-";
}

export function buildDisplayRecords(
  student: Student | null,
  history: PaymentRecord[],
  baseCount?: number
) {
  const baseCountValue = typeof baseCount === "number" ? baseCount : computeBaseCount(student, history);
  const basePaymentDate = getBasePaymentDate(student);
  const base: DisplayRecord[] =
    baseCountValue > 0
      ? [
          {
            id: "base",
            paymentDate: basePaymentDate,
            addedCount: baseCountValue,
            startIndex: 1,
            endIndex: baseCountValue,
            isBase: true,
            refundStatus: student?.baseRefundStatus,
            refundSessionIndex: student?.baseRefundSessionIndex,
            refundRatio: student?.baseRefundRatio,
            refundReason: student?.baseRefundReason,
            refundRequestedAt: student?.baseRefundRequestedAt,
            refundProcessedAt: student?.baseRefundProcessedAt,
            refundProcessedDate: student?.baseRefundProcessedDate,
            refundConsultNote: student?.baseRefundConsultNote,
          },
        ]
      : [];

  return { baseCount: baseCountValue, displayRecords: [...base, ...history] };
}

export function normalizePaymentHistoryRanges(records: PaymentRecord[], baseCount: number): PaymentRecord[] {
  let cursor = Math.max(0, Math.floor(Number(baseCount) || 0));
  return records.map((r) => {
    const cnt = Math.max(0, Math.floor(Number(r.addedCount) || 0));
    const startIndex = cursor + 1;
    const endIndex = startIndex + cnt - 1;
    cursor = endIndex;
    return { ...r, addedCount: cnt, startIndex, endIndex };
  });
}

export function refundRatioLabel(ratio?: PaymentRecord["refundRatio"]) {
  if (ratio === "full") return "전액";
  if (ratio === "two_thirds") return "2/3";
  if (ratio === "half") return "1/2";
  if (ratio === "none") return "0";
  return "-";
}

export function computeRefundRatio(
  record: PaymentRecord,
  requestIndex: number,
  isBase = false
): RefundRatio {
  if (requestIndex <= record.startIndex) return "full";
  const count = Math.max(1, record.addedCount);
  const completed = Math.max(0, requestIndex - record.startIndex);
  const ratio = completed / count;
  if (isBase && ratio <= 1 / 4) return "full";
  if (ratio < 1 / 3) return "two_thirds";
  if (ratio < 1 / 2) return "half";
  return "none";
}
