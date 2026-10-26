"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface ProgramItem {
  id: string;
  name: string;
  badge: string;
  badgeColor: "blue" | "emerald";
  durationLabel: string;
  price: number;
  priceFormatted: string;
  description: string;
  features: string[];
}

const PROGRAMS: ProgramItem[] = [
  {
    id: "group-lesson",
    name: "180분 그룹 수업 (4회) + 90분 개별 피드백 (4회)",
    badge: "그룹 수업 + 개별 피드백 (주 270분)",
    badgeColor: "blue",
    durationLabel: "4주 과정 (총 18시간)",
    price: 360000,
    priceFormatted: "360,000",
    description:
      "매주 [그룹 수업 180분 + 1:1 개인 피드백 90분]을\n4주 동안 진행하는 수업 프로그램입니다.",
    features: [
      "주당 수업: 매주 270분",
      "총 교습 시간: 4주 동안 18시간 진행",
      "진행 방식: Google Meet 실시간 라이브 & 과제 첨삭",
      "수강 주기: 4주",
    ],
  },
  {
    id: "private-lesson",
    name: "90분 개별 피드백 (8회)",
    badge: "개별 피드백 (주 180분)",
    badgeColor: "emerald",
    durationLabel: "4주 과정 (총 12시간)",
    price: 360000,
    priceFormatted: "360,000",
    description:
      "매주 [1:1 맞춤 개인 피드백 90분, 2회]을\n4주 동안 진행하는 수업 프로그램입니다.",
    features: [
      "주당 수업: 매주 90분, 2회",
      "총 교습 시간: 4주 동안 12시간 진행",
      "진행 방식: Google Meet 전용 화상 수업 및 개별 진도",
      "수강 주기: 4주",
    ],
  },
];

// Toss Payments standard client key (Production Live)
const TOSS_CLIENT_KEY =
  process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ||
  "live_ck_GePWvyJnrKQZwOZZEGLe3gLzN97E";

export default function ProgramsCheckoutClient() {
  const [activeTabId, setActiveTabId] = useState<string>("group-lesson");
  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [studentName, setStudentName] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  // Load Toss Payments SDK v1 script
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ((window as unknown as { TossPayments?: unknown }).TossPayments) return;

    const script = document.createElement("script");
    script.src = "https://js.tosspayments.com/v1/payment";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      // Keep script cached
    };
  }, []);

  const handleOpenModal = (program: ProgramItem) => {
    setSelectedProgram(program);
    setErrorMessage("");
  };

  const handleCloseModal = () => {
    setSelectedProgram(null);
    setErrorMessage("");
    setIsLoading(false);
  };

  const handleRequestPayment = async () => {
    if (!selectedProgram) return;

    if (!buyerName.trim()) {
      setErrorMessage("신청자(학부모/수강생) 성명을 입력해 주세요.");
      return;
    }

    if (!buyerPhone.trim()) {
      setErrorMessage("연락처를 입력해 주세요.");
      return;
    }

    if (!agreeTerms) {
      setErrorMessage("이용약관 및 취소/환불 규정 동의가 필요합니다.");
      return;
    }

    const TossPaymentsConstructor = (
      window as unknown as {
        TossPayments?: (key: string) => {
          requestPayment: (
            type: string,
            params: Record<string, unknown>
          ) => Promise<unknown>;
        };
      }
    ).TossPayments;

    if (!TossPaymentsConstructor) {
      setErrorMessage("결제 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    try {
      setIsLoading(true);
      setErrorMessage("");

      const toss = TossPaymentsConstructor(TOSS_CLIENT_KEY);
      const uniqueOrderId = `OJS_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;

      await toss.requestPayment("카드", {
        amount: selectedProgram.price,
        orderId: uniqueOrderId,
        orderName: selectedProgram.name,
        customerName: buyerName,
        successUrl: `${window.location.origin}/programs/success`,
        failUrl: `${window.location.origin}/programs/fail`,
      });
    } catch (err: unknown) {
      setIsLoading(false);
      const error = err as { code?: string; message?: string };
      if (error?.code === "USER_CANCEL") {
        setErrorMessage("결제창을 닫았습니다.");
      } else {
        setErrorMessage(error?.message || "결제 요청 중 오류가 발생했습니다.");
      }
    }
  };

  return (
    <>
      {/* Mobile Segmented Tab Selector (모바일 전용 탭 전환) */}
      <div className="sm:hidden mb-4 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex gap-1">
        {PROGRAMS.map((prog) => {
          const isActive = activeTabId === prog.id;
          return (
            <button
              key={prog.id}
              type="button"
              onClick={() => setActiveTabId(prog.id)}
              className={`flex-1 programs-tab-btn transition-all text-center ${
                isActive
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {prog.id === "group-lesson" ? "그룹 수업 (270분)" : "개별 피드백 (180분)"}
            </button>
          );
        })}
      </div>

      {/* Program Cards Grid (PC: 2열 나란히 / 모바일: 선택된 탭 1개 집중 표시) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {PROGRAMS.map((prog) => {
          const isBlue = prog.badgeColor === "blue";
          const isHiddenOnMobile = activeTabId !== prog.id;

          return (
            <div
              key={prog.id}
              className={`rounded-2xl border p-5 sm:p-6 bg-white dark:bg-slate-800 shadow-sm flex flex-col justify-between transition-all ${
                isHiddenOnMobile ? "hidden sm:flex" : "flex"
              } ${
                isBlue
                  ? "border-slate-200 dark:border-slate-700 hover:border-blue-400"
                  : "border-slate-200 dark:border-slate-700 hover:border-emerald-400"
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg ${
                      isBlue
                        ? "bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
                        : "bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200"
                    }`}
                  >
                    {prog.badge}
                  </span>
                  <span className="text-xs text-slate-500 font-medium">
                    {prog.durationLabel}
                  </span>
                </div>

                <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
                  {prog.name}
                </h3>

                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 whitespace-pre-line leading-relaxed">
                  {prog.description}
                </p>

                <ul className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 space-y-2 mb-6 bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800">
                  {prog.features.map((feat, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span
                        className={`font-bold ${
                          isBlue ? "text-blue-600" : "text-emerald-600"
                        }`}
                      >
                        ✓
                      </span>
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                <div className="flex items-baseline justify-between sm:block">
                  <span className="text-xs text-slate-500 font-medium sm:block">
                    수강료
                  </span>
                  <span
                    className={`text-2xl font-black ${
                      isBlue
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {prog.priceFormatted}
                    <span className="text-sm font-normal text-slate-600 dark:text-slate-400 ml-0.5">
                      원
                    </span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenModal(prog)}
                  className={`w-full sm:w-auto programs-action-btn shadow-md transition-all active:scale-[0.98] cursor-pointer text-white flex items-center justify-center gap-2 ${
                    isBlue
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  <span className="text-base leading-none">💳</span>
                  <span className="leading-none tracking-tight">수강 신청 및 결제하기</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Checkout Modal (PC: 센터 팝업 / 모바일: 바텀 시트) */}
      {selectedProgram && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={handleCloseModal}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl shadow-2xl border-t sm:border border-slate-200 dark:border-slate-800 max-w-lg w-full p-5 sm:p-7 relative max-h-[92vh] sm:max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile Drag Handle (모바일 상단 핸들 바) */}
            <div className="w-12 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto mb-2 sm:hidden shrink-0" />

            {/* Modal Header */}
            <div className="flex justify-between items-start pb-3 sm:pb-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
              <div>
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                  Toss Payments 연동
                </span>
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                  수강 신청 및 결제 주문서
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 text-2xl leading-none cursor-pointer"
                aria-label="닫기"
              >
                ×
              </button>
            </div>

            {/* Modal Body */}
            <div className="py-3 sm:py-4 space-y-3 sm:space-y-4 overflow-y-auto pr-0.5">
              {/* Product Info Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/80 space-y-1.5">
                <div className="text-xs text-slate-500 font-medium">선택한 프로그램</div>
                <div className="font-bold text-slate-900 dark:text-slate-100 text-sm sm:text-base">
                  {selectedProgram.name}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center justify-between pt-1">
                  <span>수강 기간: {selectedProgram.durationLabel}</span>
                  <span className="font-black text-blue-600 dark:text-blue-400 text-base">
                    {selectedProgram.priceFormatted}원
                  </span>
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    신청자 성명 (학부모 / 수강생) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    placeholder="홍길동"
                    className="w-full px-3.5 py-3 sm:py-2 text-base sm:text-sm rounded-xl sm:rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    연락처 (휴대폰 번호) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    placeholder="010-1234-5678"
                    className="w-full px-3.5 py-3 sm:py-2 text-base sm:text-sm rounded-xl sm:rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    수강생 이름 (신청자와 다른 경우)
                  </label>
                  <input
                    type="text"
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    placeholder="예: 김철수 (선택 사항)"
                    className="w-full px-3.5 py-3 sm:py-2 text-base sm:text-sm rounded-xl sm:rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Terms Agreement */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500 w-4 h-4 shrink-0"
                    />
                    <span className="leading-tight">
                      [필수]{" "}
                      <Link
                        href="/policy"
                        target="_blank"
                        className="underline text-blue-600 dark:text-blue-400"
                      >
                        이용약관
                      </Link>{" "}
                      및{" "}
                      <Link
                        href="/programs#refund"
                        className="underline text-blue-600 dark:text-blue-400"
                      >
                        취소/환불 규정
                      </Link>
                      을 확인하였으며 이에 동의합니다.
                    </span>
                  </label>
                </div>

                {errorMessage && (
                  <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
                    ⚠️ {errorMessage}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="pt-3 sm:pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 programs-modal-btn border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleRequestPayment}
                disabled={isLoading}
                className="flex-2 programs-modal-btn bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold shadow-md transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
              >
                <span className="leading-none text-center">
                  {isLoading ? "결제창 호출 중..." : `💳 ${selectedProgram.priceFormatted}원 결제하기`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
