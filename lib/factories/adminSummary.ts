import type { PaymentRecord, SessionMeta, StudentStatus } from "@/lib/types/index";
import type { StudentStatusKind } from "@/lib/factories/studentStatusFactory";
import { kstDateMs, ymdFromISO_KST } from "@/lib/utils/date";

export type AdminSummaryInput = {
  student: { status: StudentStatus; paymentHistory?: PaymentRecord[] };
  status: StudentStatusKind;
  sessions: Array<{ effectiveISO: string | null; meta: SessionMeta }>;
};

export type AdminSummary = {
  activeCount: number;
  weekSessionCount: number;
  extensionCount: number;
  monthPaymentCount: number;
};

/** 오늘(KST)이 속한 주의 월요일~일요일 날짜("YYYY-MM-DD") */
export function kstWeekRange(todayYmd: string): { start: string; end: string } {
  const ms = kstDateMs(todayYmd) ?? Date.now();
  const weekday = new Date(ms + 9 * 3600_000).getUTCDay(); // 0=일
  const startMs = ms - ((weekday + 6) % 7) * 86400_000;
  return {
    start: ymdFromISO_KST(new Date(startMs).toISOString()) ?? todayYmd,
    end: ymdFromISO_KST(new Date(startMs + 6 * 86400_000).toISOString()) ?? todayYmd,
  };
}

/** 관리자 메인 숫자 4칸: 재학생 · 이번 주 수업 · 연장 필요 · 이번 달 결제 */
export function buildAdminSummary(items: AdminSummaryInput[], todayYmd: string): AdminSummary {
  const week = kstWeekRange(todayYmd);
  const month = todayYmd.slice(0, 7);
  const summary: AdminSummary = { activeCount: 0, weekSessionCount: 0, extensionCount: 0, monthPaymentCount: 0 };

  for (const item of items) {
    if (item.student.status !== "active") continue;
    summary.activeCount += 1;
    if (item.status === "need_extension") summary.extensionCount += 1;

    for (const s of item.sessions) {
      if (s.meta.status === "absent") continue;
      const ymd = ymdFromISO_KST(s.effectiveISO);
      if (ymd && ymd >= week.start && ymd <= week.end) summary.weekSessionCount += 1;
    }

    for (const record of item.student.paymentHistory ?? []) {
      if (record.isBase || !(record.addedCount > 0)) continue;
      // 결제 기록이 만들어진 날 기준 (createdAt 없는 옛 기록은 paymentDate로)
      const ymd = ymdFromISO_KST(record.createdAt) ?? record.paymentDate;
      if (ymd?.startsWith(month)) summary.monthPaymentCount += 1;
    }
  }
  return summary;
}
