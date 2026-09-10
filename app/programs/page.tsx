import type { Metadata } from "next";
import Link from "next/link";
import ProgramsCheckoutClient from "@/lib/ui/programs/ProgramsCheckoutClient";

export const metadata: Metadata = {
  title: "수업 프로그램 및 결제 안내 | 옥진수학",
  description: "옥진수학 맞춤형 온라인 수학 코칭 수업 프로그램, 수강료 및 결제/환불 안내",
};

export default function ProgramsPage() {
  return (
    <main className="py-6" style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* 헤더 섹션 */}
      <section className="mb-8 text-center">
        <div className="inline-block px-3 py-1 mb-3 text-xs font-semibold rounded-full bg-blue-50 text-blue-700 border border-blue-200">
          옥진수학 수강 안내
        </div>
        <h1 className="text-3xl font-extrabold mb-3 text-slate-900 dark:text-slate-100">
          수업 프로그램 및 결제 안내
        </h1>
        <p className="text-base text-slate-600 dark:text-slate-300 max-w-xl mx-auto">
          옥진수학은 학생 개개인의 취약점을 정밀 진단하고, 1:1 맞춤 피드백과 체계적인 커리큘럼을 통해 수학 실력의 확실한 성장을 이끕니다.
        </p>
      </section>

      {/* 대표 수업 상품 안내 카드 그리드 & 결제 연동 클라이언트 */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4 pb-2 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <span>📚</span>
          <span>수강 프로그램 (판매 상품)</span>
        </h2>

        <ProgramsCheckoutClient />
      </section>

      {/* 수강 및 결제 진행 절차 */}
      <section className="mb-12">
        <h2 className="text-xl font-bold mb-4 pb-2 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <span>💳</span>
          <span>수강 신청 및 결제 절차</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center mx-auto mb-2 text-sm">
              1
            </div>
            <h4 className="font-bold text-sm mb-1 text-slate-900 dark:text-slate-100">학습 상담 & 진단</h4>
            <p className="text-xs text-slate-500">전화 또는 상담을 통해 학생의 성취도와 목표 분석</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center mx-auto mb-2 text-sm">
              2
            </div>
            <h4 className="font-bold text-sm mb-1 text-slate-900 dark:text-slate-100">프로그램 결정 & 결제</h4>
            <p className="text-xs text-slate-500">맞춤 프로그램 확정 및 수강료 결제 (계좌이체/카드)</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center mx-auto mb-2 text-sm">
              3
            </div>
            <h4 className="font-bold text-sm mb-1 text-slate-900 dark:text-slate-100">수업 캘린더 생성</h4>
            <p className="text-xs text-slate-500">학생 전용 고정 Meet 링크 및 일정 자동 배정</p>
          </div>
          <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-center">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center mx-auto mb-2 text-sm">
              4
            </div>
            <h4 className="font-bold text-sm mb-1 text-slate-900 dark:text-slate-100">수업 진행 & 리포트</h4>
            <p className="text-xs text-slate-500">실시간 화상 수업 진행 및 주간 학습 현황 공유</p>
          </div>
        </div>

        <div className="mt-4 p-4 rounded-lg bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-sm text-slate-700 dark:text-slate-300">
          <p className="font-bold text-blue-900 dark:text-blue-300 mb-1">
            📌 수강 신청 및 결제 문의
          </p>
          <p>
            수강 등록 및 결제 관련 안내는 대표 전화(<strong>010-8972-7209</strong>) 또는 이메일(<strong>rapah0310@gmail.com</strong>)로 문의해주시면 친절히 안내해 드립니다.
          </p>
        </div>
      </section>

      {/* 취소 및 환불 규정 (학원법 및 전자상거래법 준수) */}
      <section id="refund" className="mb-12">
        <h2 className="text-xl font-bold mb-4 pb-2 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <span>⚖️</span>
          <span>취소 및 환불 규정</span>
        </h2>

        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-5 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-300">
          <p className="mb-3 text-slate-600 dark:text-slate-400">
            옥진수학은 「전자상거래 등에서의 소비자보호에 관한 법률」 등 관련 법령을 준수하며, 잔여 수업 시수에 비례한 투명하고 공정한 환불 기준을 운영합니다.
          </p>

          <div className="overflow-x-auto my-4">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="bg-slate-100 dark:bg-slate-900/70 border-y border-slate-200 dark:border-slate-700">
                  <th className="p-2.5 font-bold text-slate-800 dark:text-slate-200">구분</th>
                  <th className="p-2.5 font-bold text-slate-800 dark:text-slate-200">취소 및 환불 요청 시점</th>
                  <th className="p-2.5 font-bold text-slate-800 dark:text-slate-200">반환 금액 기준</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                <tr>
                  <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">수업 시작 전</td>
                  <td className="p-2.5">첫 수업 개시일 전일까지 취소 요청 시</td>
                  <td className="p-2.5 font-bold text-blue-600">이미 납부한 수강료 전액 환불</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">수업 시작 후 (4주 과정)</td>
                  <td className="p-2.5">잔여 수업 시간이 남아 있는 경우</td>
                  <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">
                    <strong>(잔여 수업 시간 / 총 등록 수업 시간)</strong> 비율 환불
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5 text-xs text-slate-500 dark:text-slate-400 mt-4 p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
            <p className="font-semibold text-slate-700 dark:text-slate-300">
              ※ 환불 당일 예정 수업 처리 기준
            </p>
            <p>
              • 1:1 맞춤 예약 수업의 특성 및 강사 일정 점유에 따라, <strong>수업 당일(수업 시작 12시간 이내)</strong>에 취소/환불을 요청하시는 경우 <strong>당일 예정된 수업 시간은 이미 진행된 것으로 간주하여 잔여 시간에서 제외</strong> 후 정산됩니다.
            </p>
            <p>
              • 환불 신청은 대표 전화(010-8972-7209) 또는 이메일(rapah0310@gmail.com)로 접수하실 수 있으며, 접수일/접수 시각 기준으로 반환 금액이 산정됩니다.
            </p>
            <p>
              • 신용카드 결제 취소는 카드사 승인 취소 절차에 따르며, 계좌이체 결제 시 환불 요청일로부터 영업일 기준 3일 이내에 지정하신 계좌로 환불 처리됩니다.
            </p>
          </div>
        </div>
      </section>

      {/* 홈으로 돌아가기 버튼 */}
      <div className="text-center pt-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm transition-colors"
        >
          <span>←</span>
          <span>홈으로 돌아가기</span>
        </Link>
      </div>
    </main>
  );
}
