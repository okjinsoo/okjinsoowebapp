-- 013_atomic_state_kv_patch.sql
-- Phase 2 (선택지 B): state_kv 원자적(Atomic) 부분 병합 및 삭제 RPC 함수
-- 작성일: 2026-11-13
-- 목적:
-- 1. 기존 Read -> JS Merge -> Full Write 구조에서 발생하던 동시 덮어쓰기(Lost Update) 문제를 원천 해결
-- 2. DB 내부에서 단일 UPDATE 문으로 특정 state_kv 키만 원자적으로 병합(||) 및 삭제(-) 처리
-- 3. 레거시 백업 키(mk3:backup:...)가 남아있을 경우에도 안전하게 유지/정리

BEGIN;

CREATE OR REPLACE FUNCTION public.patch_snapshot_state_kv(
  p_snapshot_id text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_drop_keys text[] DEFAULT ARRAY[]::text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.app_state_snapshots
  SET
    state_kv = (COALESCE(state_kv, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb)) - COALESCE(p_drop_keys, ARRAY[]::text[]),
    updated_at = now()
  WHERE id = p_snapshot_id;

  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.patch_snapshot_state_kv(text, jsonb, text[]) IS
  'app_state_snapshots.state_kv의 지정된 키만 원자적으로 병합/삭제하여 동시성 충돌(Lost Update)을 방지합니다.';

COMMIT;

