-- 012_lockdown_rls_policies.sql
-- Phase 1 (선택지 A): DB 테이블 보안 잠금 (RLS Lockdown)
-- 작성일: 2026-11-12
-- 목적:
-- 1. 기존 011_normalize_tables_and_occ.sql의 과도하게 개방된 정책(TO authenticated USING (true))을 제거
-- 2. 클라이언트(브라우저)가 서버 API(/api/snapshot, /api/students 등)를 우회하여 직접 DB를 읽거나 덮어쓰지 못하도록 차단
-- 3. 서버(service_role)는 RLS를 자동 통과하며, 일반 인증 사용자(authenticated)는 본인 정보(또는 관리자/선생님 권한)만 최소 허용

BEGIN;

-- 1. students 테이블의 무제한 개방 정책 제거 및 최소 권한 정책 적용
DROP POLICY IF EXISTS students_read_authenticated ON public.students;
DROP POLICY IF EXISTS students_write_authenticated ON public.students;
DROP POLICY IF EXISTS students_select_self_or_staff ON public.students;

CREATE POLICY students_select_self_or_staff
  ON public.students
  FOR SELECT
  TO authenticated
  USING (
    lower(coalesce(google_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    OR EXISTS (
      SELECT 1
      FROM public.role_bindings rb
      WHERE lower(rb.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND rb.role IN ('admin', 'teacher')
    )
  );

-- 2. sessions 테이블의 무제한 개방 정책 제거 및 최소 권한 정책 적용
DROP POLICY IF EXISTS sessions_read_authenticated ON public.sessions;
DROP POLICY IF EXISTS sessions_write_authenticated ON public.sessions;
DROP POLICY IF EXISTS sessions_select_self_or_staff ON public.sessions;

CREATE POLICY sessions_select_self_or_staff
  ON public.sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = public.sessions.student_id
        AND lower(coalesce(s.google_email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    OR EXISTS (
      SELECT 1
      FROM public.role_bindings rb
      WHERE lower(rb.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        AND rb.role IN ('admin', 'teacher')
    )
  );

-- 3. app_state_snapshots 테이블 직접 쓰기/읽기 보호 안내
COMMENT ON TABLE public.students IS '학생 정규화 테이블 (쓰기는 서버 API 전용, 읽기는 본인 또는 교직원만 허용)';
COMMENT ON TABLE public.sessions IS '수업 회차 정규화 테이블 (쓰기는 서버 API 전용, 읽기는 본인 또는 교직원만 허용)';

COMMIT;

