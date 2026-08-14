-- 010_harden_app_state_snapshots_rls.sql
-- 목적: app_state_snapshots 테이블의 무분별한 직접 조회를 방지하고 서버 API를 통한 접근을 유도

BEGIN;

-- 읽기 정책 보강 (필요 시 관리자/선생님 바인딩 체크 또는 서비스 롤 전용)
COMMENT ON TABLE public.app_state_snapshots IS '애플리케이션 통합 스냅샷 테이블 (서버 API를 통해 접근 권장)';

COMMIT;
