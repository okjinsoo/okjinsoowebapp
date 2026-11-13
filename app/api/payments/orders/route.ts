import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { resolveViewerContext } from "@/lib/server/supabaseSnapshotApi";
import { fetchPaymentOrdersForAdmin } from "@/lib/server/paymentOrderStore";

/**
 * GET /api/payments/orders
 * 관리자(admin) 전용 온라인 수강 신청 및 결제 승인 장부 조회 API
 */
export async function GET(request: NextRequest) {
  try {
    const viewer = await resolveViewerContext(request, {
      includeSessions: false,
      includeStateKv: false,
    });

    if (!viewer || viewer.role !== "admin") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await fetchPaymentOrdersForAdmin();
    return NextResponse.json({
      ok: true,
      source: result.source,
      count: result.orders.length,
      orders: result.orders,
    });
  } catch (error) {
    console.error("[Payment Orders API] GET failed:", error);
    return NextResponse.json({ error: "payment_orders_fetch_failed" }, { status: 500 });
  }
}

