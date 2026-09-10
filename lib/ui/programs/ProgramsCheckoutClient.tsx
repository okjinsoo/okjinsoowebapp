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
    name: "그룹 수업 + 1:1 개별 피드백 (4주)",
    badge: "그룹 코칭 (주 5시간)",
    badgeColor: "blue",
    durationLabel: "4주 과정 (총 20시간)",
    price: 360000,
    priceFormatted: "360,000",
    description: "매주 그룹 수업 3시간 + 1:1 개별 피드백 2시간(주 5시간)을 4주 동안 체계적으로 진행하는 종합 코칭 프로그램입니다.",
    features: [
      "주당 수업: 매주 5시간 (그룹수업 3시간 + 개별피드백 2시간)",
      "총 교습 시수: 4주간 총 20시간 (그룹 12시간 + 피드백 8시간)",
      "진행 방식: Google Meet 실시간 라이브 & 과제 첨삭",
      "수강 주기: 4주 단위 등록 및 갱신",
    ],
  },
  {
    id: "private-lesson",
    name: "1:1 맞춤형 개인 과외 (4주)",
    badge: "1:1 맞춤 과외 (주 4시간)",
    badgeColor: "emerald",
    durationLabel: "4주 과정 (총 16시간)",
    price: 360000,
    priceFormatted: "360,000",
    description: "매주 1:1 맞춤 개인 과외 4시간(주 4시간)을 4주 동안 집중적으로 진행하여 취약 단원을 단기간에 보완하는 밀착 관리 프로그램입니다.",
    features: [
      "주당 수업: 매주 1:1 개인 과외 4시간",
      "총 교습 시수: 4주간 총 16시간 (1:1 밀착 코칭)",
      "진행 방식: Google Meet 전용 화상 수업 및 개별 진도",
      "수강 주기: 4주 단위 등록 및 갱신",
    ],
  },
];

// Toss Payments standard test client key
const TOSS_CLIENT_KEY =
  process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ||
  "test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq";

export default function ProgramsCheckoutClient() {
  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [buyerName, setBuyerName] = useState("홍길동");
  const [buyerPhone, setBuyerPhone] = useState("010-1234-5678");
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
      {/* Program Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {PROGRAMS.map((prog) => {
          const isBlue = prog.badgeColor === "blue";
          return (
            <div
              key={prog.id}
              className={`rounded-xl border p-6 bg-white dark:bg-slate-800 shadow-sm flex flex-col justify-between transition-all ${
                isBlue
                  ? "border-slate-200 dark:border-slate-700 hover:border-blue-400"
                  : "border-slate-200 dark:border-slate-700 hover:border-emerald-400"
              }`}
            >
              <div>
                <div className="flex justify-between items-start mb-3">
                  <span
                    className={`px-2.5 py-1 text-xs font-bold rounded ${
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

                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-2">
                  {prog.name}
                </h3>

                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {prog.description}
                </p>

                <ul className="text-sm text-slate-600 dark:text-slate-300 space-y-2 mb-6 bg-slate-50 dark:bg-slate-900/50 p-3.5 rounded-lg border border-slate-100 dark:border-slate-800">
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

              <div className="pt-4 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div>
                  <span className="text-xs text-slate-500 font-medium block">
                    수강료 (4주 과정)
                  </span>
                  <span
                    className={`text-2xl font-black ${
                      isBlue
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }`}
                  >
                    {prog.priceFormatted}
                    <span className="text-sm font-normal text-slate-600 dark:text-slate-400">
                      원
                    </span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleOpenModal(prog)}
                  className={`w-full sm:w-auto px-5 py-2.5 rounded-lg font-bold text-sm text-white shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                    isBlue
                      ? "bg-blue-600 hover:bg-blue-700"
                      : "bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  <span>💳</span>
                  <span>수강 신청 및 결제하기</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Checkout Modal */}
      {selectedProgram && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={handleCloseModal}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full p-6 sm:p-7 relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex justify-between items-start pb-4 border-b border-slate-100 dark:border-slate-800">
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
            <div className="py-4 space-y-4">
              {/* Product Info Box */}
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/80 space-y-1.5">
                <div className="text-xs text-slate-500 font-medium">선택한 프로그램</div>
                <div className="font-bold text-slate-900 dark:text-slate-100 text-base">
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
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    placeholder="예: 옥학생 (선택 사항)"
                    className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Terms Agreement */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>
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
            <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex gap-2.5">
              <button
                type="button"
                onClick={handleCloseModal}
                className="flex-1 py-2.5 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleRequestPayment}
                disabled={isLoading}
                className="flex-2 py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-bold shadow-md transition-colors cursor-pointer flex items-center justify-center gap-1.5"
              >
                <span>{isLoading ? "결제창 호출 중..." : `💳 ${selectedProgram.priceFormatted}원 결제하기`}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
