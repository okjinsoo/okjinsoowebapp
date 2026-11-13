-- 014_create_payment_orders.sql
-- Phase 3 (선택지 C): 온라인 수강 신청 및 토스페이먼츠 결제 승인 장부 테이블 구축
-- 작성일: 2026-11-13
-- 목적:
-- 1. /programs 페이지에서 학부모/수강생이 결제 완료 시 신청자명, 연락처, 수강생 이름, 프로그램명, 결제 금액, 영수증 URL을 영구 보관
-- 2. 결제 완료 직후 브라우저 창을 닫더라도 서버에 결제 신청 정보가 100% 보존되도록 보장
-- 3. RLS(Row Level Security)를 통해 외부 직접 접근을 차단하고 서버(service_role) 및 관리자(admin)만 열람 가능하도록 보호

BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_orders (
  order_id text PRIMARY KEY,
  payment_key text NOT NULL,
  program_id text NOT NULL DEFAULT '',
  order_name text NOT NULL DEFAULT '',
  amount int NOT NULL CHECK (amount > 0),
  buyer_name text NOT NULL DEFAULT '',
  buyer_phone text NOT NULL DEFAULT '',
  student_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'DONE',
  method text NOT NULL DEFAULT '',
  approved_at timestamptz,
  receipt_url text DEFAULT '',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_created_at
  ON public.payment_orders (created_at DESC);

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_orders_select_admin ON public.payment_orders;

CREATE POLICY payment_orders_select_admin
  ON public.payment_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.role_bindings rb
      WHERE lower(rb.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND rb.role = 'admin'
    )
  );

COMMENT ON TABLE public.payment_orders IS '온라인 수강 신청 및 토스페이먼츠 결제 승인 원장 테이블 (서버 전용 기록 및 관리자 조회)';

COMMIT;

