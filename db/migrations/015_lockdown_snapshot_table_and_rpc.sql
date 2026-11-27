-- 015_lockdown_snapshot_table_and_rpc.sql
-- 작성일: 2026-11-27
-- 목적 (보안 점검 Must fix 1~3):
-- 1. app_state_snapshots 를 일반 로그인 사용자(authenticated)가 브라우저에서 직접 읽기/쓰기 하지 못하게 잠근다.
--    (기존 004·007 정책 때문에 구글 로그인만 하면 전체 명단을 읽거나 main 줄을 덮어쓸 수 있었음)
-- 2. patch_snapshot_state_kv(SECURITY DEFINER) 를 anon/authenticated 가 호출하지 못하게 막는다.
--    (Supabase 기본 권한 때문에 로그인 없이도 공개 키로 호출 가능했음)
-- 서버는 모든 읽기/쓰기를 service_role 로 하므로(서버 코드 기준) 이 잠금 후에도 앱은 그대로 동작한다.
--
-- 적용 전 확인: Vercel 운영 환경변수에 SUPABASE_SERVICE_ROLE_KEY 가 설정되어 있어야 한다.
-- 적용 순서: 이 SQL 은 같은 커밋의 서버 코드(proxy 역할 판별의 service_role 읽기)가 운영에 배포된 뒤 실행한다.

BEGIN;

-- 1. 일반 사용자용 스냅샷 정책 모두 제거 (004 원본 + 007 대체본)
DROP POLICY IF EXISTS app_state_snapshots_read_all_authenticated ON public.app_state_snapshots;
DROP POLICY IF EXISTS app_state_snapshots_write_all_authenticated ON public.app_state_snapshots;
DROP POLICY IF EXISTS app_state_snapshots_update_all_authenticated ON public.app_state_snapshots;
DROP POLICY IF EXISTS app_state_snapshots_write_main_authenticated ON public.app_state_snapshots;
DROP POLICY IF EXISTS app_state_snapshots_update_main_authenticated ON public.app_state_snapshots;

ALTER TABLE public.app_state_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_state_snapshots FROM anon, authenticated;

-- 2. 원자적 state_kv 병합 함수는 서버(service_role) 전용
REVOKE EXECUTE ON FUNCTION public.patch_snapshot_state_kv(text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_snapshot_state_kv(text, jsonb, text[]) TO service_role;

COMMIT;

-- 적용 후 확인용 (둘 다 결과에 anon/authenticated 가 없어야 정상):
-- select policyname, roles, cmd from pg_policies where tablename = 'app_state_snapshots';
-- select grantee, privilege_type from information_schema.routine_privileges where routine_name = 'patch_snapshot_state_kv';
