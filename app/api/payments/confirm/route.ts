import { NextResponse } from "next/server";
import { validatePaymentConfirmInput } from "@/lib/server/paymentValidation";
import { recordConfirmedPaymentOrder, type PaymentOrderRecord } from "@/lib/server/paymentOrderStore";

function buildOrderRecordFromToss(args: {
  orderId: string;
  paymentKey: string;
  amount: number;
  body: Record<string, unknown>;
  tossData: Record<string, unknown>;
}): PaymentOrderRecord {
  const programId = typeof args.body.programId === "string" ? args.body.programId.trim() : "";
  const buyerNameFromBody = typeof args.body.buyerName === "string" ? args.body.buyerName.trim() : "";
  const buyerPhone = typeof args.body.buyerPhone === "string" ? args.body.buyerPhone.trim() : "";
  const studentName = typeof args.body.studentName === "string" ? args.body.studentName.trim() : "";

  const orderName =
    typeof args.tossData.orderName === "string" && args.tossData.orderName.trim()
      ? args.tossData.orderName.trim()
      : "옥진수학 수강 프로그램";
  const method = typeof args.tossData.method === "string" ? args.tossData.method : "카드";
  const status = typeof args.tossData.status === "string" ? args.tossData.status : "DONE";
  const approvedAt = typeof args.tossData.approvedAt === "string" ? args.tossData.approvedAt : null;
  const receiptObj =
    args.tossData.receipt && typeof args.tossData.receipt === "object"
      ? (args.tossData.receipt as { url?: unknown })
      : null;
  const receiptUrl = typeof receiptObj?.url === "string" ? receiptObj.url : "";

  return {
    orderId: args.orderId,
    paymentKey: args.paymentKey,
    programId,
    orderName,
    amount: args.amount,
    buyerName: buyerNameFromBody,
    buyerPhone,
    studentName,
    status,
    method,
    approvedAt,
    receiptUrl,
    createdAt: approvedAt ?? new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const validation = validatePaymentConfirmInput(body ?? {});
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, code: validation.code, message: validation.message },
        { status: 400 }
      );
    }

    const secretKey = (process.env.TOSS_SECRET_KEY ?? "").trim();
    if (!secretKey) {
      console.error("[Toss Payments] Server configuration error: TOSS_SECRET_KEY is not set.");
      return NextResponse.json(
        {
          success: false,
          code: "SERVER_CONFIG_MISSING",
          message: "결제 서버 환경변수가 설정되지 않았습니다. 관리자에게 문의해 주세요.",
        },
        { status: 500 }
      );
    }

    const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");

    const tossResponse = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey: validation.paymentKey,
        orderId: validation.orderId,
        amount: validation.amount,
      }),
      cache: "no-store",
    });

    const data = await tossResponse.json();

    if (!tossResponse.ok) {
      // 이미 승인된 결제인지 확인 (ALREADY_APPROVED)
      if (data?.code === "ALREADY_APPROVED") {
        // 오류 응답(data)에는 승인 시각·영수증이 없으므로, 실제 결제 정보를 다시 받아 기록한다.
        // 조회가 실패하면 기존 장부를 덮어쓰지 않는다(새로고침 시 장부 훼손 방지).
        const lookupRes = await fetch(
          `https://api.tosspayments.com/v1/payments/${encodeURIComponent(validation.paymentKey)}`,
          { headers: { Authorization: `Basic ${basicAuth}` }, cache: "no-store" }
        );
        const payment = lookupRes.ok ? ((await lookupRes.json()) as Record<string, unknown>) : null;
        if (payment && payment.orderId === validation.orderId) {
          const orderRecord = buildOrderRecordFromToss({
            orderId: validation.orderId,
            paymentKey: validation.paymentKey,
            amount: validation.amount,
            body: (body ?? {}) as Record<string, unknown>,
            tossData: payment,
          });
          await recordConfirmedPaymentOrder(orderRecord, payment);
        }

        return NextResponse.json({
          success: true,
          alreadyApproved: true,
          payment: payment ?? data,
        });
      }

      console.error("[Toss Payments] Confirm API failed:", tossResponse.status, data);
      return NextResponse.json(
        {
          success: false,
          code: data?.code || "PAYMENT_CONFIRM_FAILED",
          message: data?.message || "결제 승인 처리 중 오류가 발생했습니다.",
        },
        { status: tossResponse.status }
      );
    }

    // [선택지 C: 결제 장부 자동 기록] 토스 승인 즉시 서버 DB 및 스냅샷 백업 장부에 영구 기록
    const orderRecord = buildOrderRecordFromToss({
      orderId: validation.orderId,
      paymentKey: validation.paymentKey,
      amount: validation.amount,
      body: (body ?? {}) as Record<string, unknown>,
      tossData: (data ?? {}) as Record<string, unknown>,
    });
    const ledgerResult = await recordConfirmedPaymentOrder(
      orderRecord,
      (data ?? {}) as Record<string, unknown>
    );

    return NextResponse.json({
      success: true,
      ledgerSaved: ledgerResult.savedToTable || ledgerResult.savedToSnapshotFallback,
      payment: data,
    });
  } catch (error) {
    console.error("[Toss Payments] Confirm route exception:", error);
    return NextResponse.json(
      { success: false, message: "결제 승인 서버 내부 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
