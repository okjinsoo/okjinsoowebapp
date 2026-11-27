-- 016_apply_atomic_state_kv_patch_locked.sql
-- 작성일: 2026-11-27
-- 목적:
-- 1. 운영 DB에 적용된 적 없는 013(patch_snapshot_state_kv)을 적용해, 서버의 state_kv 저장을
--    '읽고 → 합치고 → 통째로 쓰기'(동시 저장 시 한쪽 유실) 대신 DB 안 한 번의 UPDATE 로 처리한다.
-- 2. 015 와 같은 잠금을 처음부터 건다: 실행 권한은 서버(service_role) 전용.
-- 3. 지금의 서버 비상 경로와 똑같이 레거시 백업 키(mk3:backup:...)도 함께 정리한다.
-- 서버 코드는 이미 이 함수를 먼저 부르고, 없을 때만 비상 경로로 가므로 코드 배포 없이 SQL 만 실행하면 된다.

BEGIN;

CREATE OR REPLACE FUNCTION public.patch_snapshot_state_kv(
  p_snapshot_id text,
  p_patch jsonb DEFAULT '{}'::jsonb,
  p_drop_keys text[] DEFAULT ARRAY[]::text[]
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_state_snapshots
  SET
    state_kv = (
      (COALESCE(state_kv, '{}'::jsonb) || COALESCE(p_patch, '{}'::jsonb))
      - COALESCE(p_drop_keys, ARRAY[]::text[])
      - COALESCE(
          ARRAY(SELECT k FROM jsonb_object_keys(COALESCE(state_kv, '{}'::jsonb)) AS k WHERE k LIKE 'mk3:backup:%'),
          ARRAY[]::text[]
        )
    ),
    updated_at = now()
  WHERE id = p_snapshot_id;

  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.patch_snapshot_state_kv(text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_snapshot_state_kv(text, jsonb, text[]) TO service_role;

COMMENT ON FUNCTION public.patch_snapshot_state_kv(text, jsonb, text[]) IS
  'app_state_snapshots.state_kv의 지정된 키만 원자적으로 병합/삭제 (서버 service_role 전용)';

COMMIT;

-- 적용 후 확인용 (grantee 에 service_role 등만 있고 anon/authenticated/PUBLIC 이 없어야 정상):
-- select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'patch_snapshot_state_kv';
