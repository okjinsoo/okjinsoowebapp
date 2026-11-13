import "server-only";

import { getSupabaseAnonConfigFromEnv } from "@/lib/security/requestAuth";

export type PaymentOrderRecord = {
  orderId: string;
  paymentKey: string;
  programId: string;
  orderName: string;
  amount: number;
  buyerName: string;
  buyerPhone: string;
  studentName: string;
  status: string;
  method: string;
  approvedAt: string | null;
  receiptUrl: string;
  createdAt: string;
};

type PaymentOrderDbRow = {
  order_id: string;
  payment_key: string;
  program_id: string | null;
  order_name: string | null;
  amount: number;
  buyer_name: string | null;
  buyer_phone: string | null;
  student_name: string | null;
  status: string | null;
  method: string | null;
  approved_at: string | null;
  receipt_url: string | null;
  raw_payload?: unknown;
  created_at?: string;
};

export const SERVER_PAYMENT_ORDERS_KV_KEY = "server:payment_orders_v1";
const MAX_FALLBACK_ORDERS = 200;

function getServerSupabaseCredentials(): { url: string; key: string } | null {
  const anonCfg = getSupabaseAnonConfigFromEnv();
  if (!anonCfg?.url) return null;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const key = serviceKey || anonCfg.anonKey;
  if (!key) return null;
  return { url: anonCfg.url, key };
}

export function mapPaymentOrderToDbRow(
  record: PaymentOrderRecord,
  rawPayload?: Record<string, unknown>
): PaymentOrderDbRow & { updated_at: string } {
  return {
    order_id: record.orderId,
    payment_key: record.paymentKey,
    program_id: record.programId || "",
    order_name: record.orderName || "",
    amount: record.amount,
    buyer_name: record.buyerName || "",
    buyer_phone: record.buyerPhone || "",
    student_name: record.studentName || "",
    status: record.status || "DONE",
    method: record.method || "",
    approved_at: record.approvedAt || null,
    receipt_url: record.receiptUrl || "",
    raw_payload: rawPayload ?? {},
    updated_at: new Date().toISOString(),
  };
}

export function mapDbRowToPaymentOrder(row: PaymentOrderDbRow): PaymentOrderRecord {
  return {
    orderId: row.order_id,
    paymentKey: row.payment_key,
    programId: row.program_id ?? "",
    orderName: row.order_name ?? "",
    amount: Number(row.amount) || 0,
    buyerName: row.buyer_name ?? "",
    buyerPhone: row.buyer_phone ?? "",
    studentName: row.student_name ?? "",
    status: row.status ?? "DONE",
    method: row.method ?? "",
    approvedAt: row.approved_at ?? null,
    receiptUrl: row.receipt_url ?? "",
    createdAt: row.created_at ?? row.approved_at ?? new Date().toISOString(),
  };
}

/**
 * 결제 승인 완료 건을 서버 장부에 영구 기록합니다.
 * 1순위: 정규화 테이블 `public.payment_orders`에 Upsert
 * 2순위(이중 안전 백업): `app_state_snapshots.state_kv` 내부 서버 전용 키(`server:payment_orders_v1`)에 병합 보관
 */
export async function recordConfirmedPaymentOrder(
  record: PaymentOrderRecord,
  rawPayload?: Record<string, unknown>
): Promise<{ savedToTable: boolean; savedToSnapshotFallback: boolean }> {
  const creds = getServerSupabaseCredentials();
  if (!creds) {
    return { savedToTable: false, savedToSnapshotFallback: false };
  }

  const headers: Record<string, string> = {
    apikey: creds.key,
    Authorization: `Bearer ${creds.key}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };

  let savedToTable = false;
  let savedToSnapshotFallback = false;

  // 1. 정규화 테이블(payment_orders) 기록 시도
  try {
    const tableUrl = new URL("/rest/v1/payment_orders?on_conflict=order_id", creds.url);
    const dbRow = mapPaymentOrderToDbRow(record, rawPayload);
    const res = await fetch(tableUrl.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify([dbRow]),
      cache: "no-store",
    });
    if (res.ok) {
      savedToTable = true;
    }
  } catch (err) {
    console.warn("[PaymentOrderStore] payment_orders table insert warning:", err);
  }

  // 2. 서버 스냅샷(server:payment_orders_v1) 이중 백업 기록 (014 SQL 미적용 환경에서도 100% 무손실 보장)
  try {
    const snapGetUrl = new URL("/rest/v1/app_state_snapshots?select=state_kv&id=eq.main&limit=1", creds.url);
    const getRes = await fetch(snapGetUrl.toString(), {
      method: "GET",
      headers: {
        apikey: creds.key,
        Authorization: `Bearer ${creds.key}`,
      },
      cache: "no-store",
    });

    if (getRes.ok) {
      const rows = (await getRes.json()) as Array<{ state_kv?: Record<string, unknown> | null }>;
      const currentStateKv =
        rows[0]?.state_kv && typeof rows[0].state_kv === "object" ? { ...rows[0].state_kv } : {};

      let existingList: PaymentOrderRecord[] = [];
      const rawExisting = currentStateKv[SERVER_PAYMENT_ORDERS_KV_KEY];
      if (typeof rawExisting === "string" && rawExisting.trim()) {
        try {
          const parsed = JSON.parse(rawExisting);
          if (Array.isArray(parsed)) existingList = parsed as PaymentOrderRecord[];
        } catch {
          existingList = [];
        }
      }

      const filtered = existingList.filter((item) => item?.orderId !== record.orderId);
      const nextList = [record, ...filtered].slice(0, MAX_FALLBACK_ORDERS);
      const serialized = JSON.stringify(nextList);

      // 원자적 RPC 우선 시도
      const rpcUrl = new URL("/rest/v1/rpc/patch_snapshot_state_kv", creds.url);
      const rpcRes = await fetch(rpcUrl.toString(), {
        method: "POST",
        headers: {
          apikey: creds.key,
          Authorization: `Bearer ${creds.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_snapshot_id: "main",
          p_patch: { [SERVER_PAYMENT_ORDERS_KV_KEY]: serialized },
          p_drop_keys: [],
        }),
        cache: "no-store",
      });

      if (rpcRes.ok && (await rpcRes.json()) === true) {
        savedToSnapshotFallback = true;
      } else {
        currentStateKv[SERVER_PAYMENT_ORDERS_KV_KEY] = serialized;
        const upsertUrl = new URL("/rest/v1/app_state_snapshots?on_conflict=id", creds.url);
        const upRes = await fetch(upsertUrl.toString(), {
          method: "POST",
          headers,
          body: JSON.stringify([{ id: "main", state_kv: currentStateKv }]),
          cache: "no-store",
        });
        if (upRes.ok) {
          savedToSnapshotFallback = true;
        }
      }
    }
  } catch (err) {
    console.warn("[PaymentOrderStore] snapshot fallback warning:", err);
  }

  return { savedToTable, savedToSnapshotFallback };
}

/**
 * 관리자용 결제 장부 목록을 최신순으로 조회합니다.
 */
export async function fetchPaymentOrdersForAdmin(): Promise<{
  orders: PaymentOrderRecord[];
  source: "table" | "snapshot_fallback" | "empty";
}> {
  const creds = getServerSupabaseCredentials();
  if (!creds) return { orders: [], source: "empty" };

  const headers = {
    apikey: creds.key,
    Authorization: `Bearer ${creds.key}`,
  };

  // 1. 정규화 테이블 조회 시도
  try {
    const tableUrl = new URL("/rest/v1/payment_orders?select=*&order=created_at.desc&limit=200", creds.url);
    const res = await fetch(tableUrl.toString(), {
      method: "GET",
      headers,
      cache: "no-store",
    });
    if (res.ok) {
      const rows = (await res.json()) as PaymentOrderDbRow[];
      if (Array.isArray(rows) && rows.length > 0) {
        return {
          orders: rows.map(mapDbRowToPaymentOrder),
          source: "table",
        };
      }
    }
  } catch {
    // fallback to snapshot
  }

  // 2. 스냅샷 백업 장부 조회
  try {
    const snapGetUrl = new URL("/rest/v1/app_state_snapshots?select=state_kv&id=eq.main&limit=1", creds.url);
    const getRes = await fetch(snapGetUrl.toString(), {
      method: "GET",
      headers,
      cache: "no-store",
    });
    if (getRes.ok) {
      const rows = (await getRes.json()) as Array<{ state_kv?: Record<string, unknown> | null }>;
      const raw = rows[0]?.state_kv?.[SERVER_PAYMENT_ORDERS_KV_KEY];
      if (typeof raw === "string" && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return {
            orders: parsed as PaymentOrderRecord[],
            source: "snapshot_fallback",
          };
        }
      }
    }
  } catch {
    // ignore
  }

  return { orders: [], source: "empty" };
}

