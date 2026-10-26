"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

interface PaymentResult {
  orderName?: string;
  totalAmount?: number;
  approvedAt?: string;
  method?: string;
  receipt?: {
    url?: string;
  };
  card?: {
    issuerCode?: string;
    acquirerCode?: string;
    number?: string;
    installmentPlanMonths?: number;
  };
}

export default function ProgramsSuccessClient() {
  const searchParams = useSearchParams();
  const paymentKey = searchParams.get("paymentKey");
  const orderId = searchParams.get("orderId");
  const amount = searchParams.get("amount");

  const [status, setStatus] = useState<"loading" | "success" | "error">(
    paymentKey && orderId && amount ? "loading" : "success"
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [paymentData, setPaymentData] = useState<PaymentResult | null>(null);

  useEffect(() => {
    // 쿼리 파라미터가 없으면 초기 상태가 이미 "success"이므로 아무 작업도 하지 않음
    if (!paymentKey || !orderId || !amount) {
      return;
    }

    let isMounted = true;

    async function confirmPayment() {
      try {
        const res = await fetch("/api/payments/confirm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentKey,
            orderId,
            amount: Number(amount),
          }),
        });

        const data = await res.json();

        if (!isMounted) return;

        if (res.ok && data.success) {
          setPaymentData(data.payment);
          setStatus("success");
        } else {
          setStatus("error");
          setErrorMessage(data.message || "결제 승인 중 오류가 발생했습니다.");
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        setStatus("error");
        setErrorMessage(
          err instanceof Error ? err.message : "네트워크 오류가 발생했습니다."
        );
      }
    }

    void confirmPayment();

    return () => {
      isMounted = false;
    };
  }, [paymentKey, orderId, amount]);

  if (status === "loading") {
    return (
      <main className="min-h-[70vh] flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
          <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            결제 최종 승인 처리 중...
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            카드사 및 토스페이먼츠와 통신 중입니다.
            <br />
            잠시만 기다려 주세요 (창을 닫지 마세요).
          </p>
        </div>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="min-h-[70vh] flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-red-200 dark:border-red-900/50 p-8 text-center">
          <div className="w-16 h-16 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
            ✕
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            결제 승인 오류
          </h1>
          <p className="text-sm text-red-600 dark:text-red-400 mb-4 leading-relaxed font-medium">
            {errorMessage || "결제 승인 처리 중 문제가 발생했습니다."}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
            카드사 승인은 이루어졌으나 가맹점 최종 처리에 문제가 발생한 경우,
            수수료 없이 자동 취소되거나 확인 후 정상 처리됩니다.
            <br />
            문의: 010-8972-7209 (rapah0310@gmail.com)
          </p>

          <div className="space-y-2">
            <Link
              href="/programs"
              className="block w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors"
            >
              수업 안내 페이지로 이동
            </Link>
            <Link
              href="/"
              className="block w-full py-2 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
            >
              홈으로 이동
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[70vh] flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 p-8 text-center">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          수강 신청 및 결제 완료
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-6 leading-relaxed">
          수강 신청 및 결제가 정상적으로 처리되었습니다.
          <br />
          수업 일정 및 Google Meet 안내는 기재해주신 연락처로 전송됩니다.
        </p>

        {paymentData && (
          <div className="mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 text-left text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500">주문명</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {paymentData.orderName || "옥진수학 수강 프로그램"}
              </span>
            </div>
            {paymentData.totalAmount && (
              <div className="flex justify-between">
                <span className="text-slate-500">결제 금액</span>
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {paymentData.totalAmount.toLocaleString()}원
                </span>
              </div>
            )}
            {orderId && (
              <div className="flex justify-between">
                <span className="text-slate-500">주문 번호</span>
                <span className="font-mono text-slate-700 dark:text-slate-300">
                  {orderId}
                </span>
              </div>
            )}
            {paymentData.receipt?.url && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-center">
                <a
                  href={paymentData.receipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 font-semibold"
                >
                  📄 매출 전표(영수증) 확인하기
                </a>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Link
            href="/programs"
            className="block w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors"
          >
            수업 안내로 돌아가기
          </Link>
          <Link
            href="/"
            className="block w-full py-2 px-4 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            홈으로 이동
          </Link>
        </div>
      </div>
    </main>
  );
}
