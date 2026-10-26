import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { paymentKey, orderId, amount } = body;

    if (!paymentKey || !orderId || amount === undefined) {
      return NextResponse.json(
        { success: false, message: "필수 결제 파라미터(paymentKey, orderId, amount)가 누락되었습니다." },
        { status: 400 }
      );
    }

    const secretKey =
      process.env.TOSS_SECRET_KEY || "live_sk_d46qopOB892elGwN5abO3ZmM75y0";
    const basicAuth = Buffer.from(`${secretKey}:`).toString("base64");

    const tossResponse = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentKey,
        orderId,
        amount: Number(amount),
      }),
      cache: "no-store",
    });

    const data = await tossResponse.json();

    if (!tossResponse.ok) {
      // 이미 승인된 결제인지 확인 (ALREADY_APPROVED)
      if (data?.code === "ALREADY_APPROVED") {
        return NextResponse.json({
          success: true,
          alreadyApproved: true,
          payment: data,
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

    return NextResponse.json({
      success: true,
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
