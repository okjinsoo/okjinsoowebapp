// 정식 판매 프로그램 가격표 (서버 측 위변조 검증용)
const ALLOWED_PROGRAM_AMOUNTS = new Set<number>([360000]);
const ORDER_ID_PREFIX = "OJS_";

export function validatePaymentConfirmInput(input: {
  paymentKey?: unknown;
  orderId?: unknown;
  amount?: unknown;
}):
  | { ok: true; paymentKey: string; orderId: string; amount: number }
  | { ok: false; code: string; message: string } {
  const paymentKey = typeof input.paymentKey === "string" ? input.paymentKey.trim() : "";
  const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
  const numericAmount = Number(input.amount);

  if (!paymentKey || !orderId || input.amount === undefined || !Number.isFinite(numericAmount)) {
    return {
      ok: false,
      code: "INVALID_PARAMETERS",
      message: "필수 결제 파라미터(paymentKey, orderId, amount)가 누락되었거나 형식이 올바르지 않습니다.",
    };
  }

  if (!orderId.startsWith(ORDER_ID_PREFIX) || orderId.length < 10) {
    return {
      ok: false,
      code: "INVALID_ORDER_ID",
      message: "유효하지 않은 주문번호 형식입니다.",
    };
  }

  if (!ALLOWED_PROGRAM_AMOUNTS.has(numericAmount)) {
    return {
      ok: false,
      code: "AMOUNT_MISMATCH",
      message: "결제 요청 금액이 정식 수강료와 일치하지 않아 승인이 차단되었습니다.",
    };
  }

  return {
    ok: true,
    paymentKey,
    orderId,
    amount: numericAmount,
  };
}

