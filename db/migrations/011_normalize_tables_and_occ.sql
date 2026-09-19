-- 011_normalize_tables_and_occ.sql
-- Phase 3: DB 테이블 정규화 및 낙관적 동시성 제어(OCC) 지원 스키마
-- 작성일: 2026-09-19
-- 목적:
-- 1. app_state_snapshots의 JSON 통짜 구조를 독립된 정규화 테이블(students, sessions, payments)로 분리
-- 2. version 컬럼 및 자동 갱신 트리거를 통한 낙관적 동시성 제어(OCC) 지원
-- 3. 기존 테이블과의 호환성 유지(IF NOT EXISTS 및 ALTER TABLE IF NOT EXISTS)

BEGIN;

-- 1. 버전 증가용 범용 OCC 함수 생성
CREATE OR REPLACE FUNCTION public.increment_version_and_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.version = COALESCE(OLD.version, 0) + 1;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 2. students 테이블 확장 및 보강
CREATE TABLE IF NOT EXISTS public.students (
  id text PRIMARY KEY,
  token text UNIQUE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  cohort text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  start_date date,
  plan_count int NOT NULL DEFAULT 4,
  google_email text,
  student_phone text,
  parent_phone text,
  school text,
  grade text,
  gender text,
  parent_role text,
  teacher_id text,
  drive_folder_id text,
  permanent_meet_url text,
  schedule_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule_change_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  payment_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 기존 001_init.sql 등으로 생성되었을 경우 누락 필드 안전 추가
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'token') THEN
    ALTER TABLE public.students ADD COLUMN token text UNIQUE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'teacher_id') THEN
    ALTER TABLE public.students ADD COLUMN teacher_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'drive_folder_id') THEN
    ALTER TABLE public.students ADD COLUMN drive_folder_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'permanent_meet_url') THEN
    ALTER TABLE public.students ADD COLUMN permanent_meet_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'schedule_rules') THEN
    ALTER TABLE public.students ADD COLUMN schedule_rules jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'schedule_change_events') THEN
    ALTER TABLE public.students ADD COLUMN schedule_change_events jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'payment_history') THEN
    ALTER TABLE public.students ADD COLUMN payment_history jsonb NOT NULL DEFAULT '[]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'version') THEN
    ALTER TABLE public.students ADD COLUMN version int NOT NULL DEFAULT 1;
  END IF;
END;
$$;

-- students 테이블 트리거 설정
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_students_occ_version'
  ) THEN
    CREATE TRIGGER trg_students_occ_version
    BEFORE UPDATE ON public.students
    FOR EACH ROW EXECUTE FUNCTION public.increment_version_and_touch_updated_at();
  END IF;
END;
$$;

-- 3. sessions 정규화 테이블
CREATE TABLE IF NOT EXISTS public.sessions (
  id text PRIMARY KEY,
  student_id text NOT NULL,
  session_index int NOT NULL CHECK (session_index > 0),
  display_at timestamptz,
  memo text DEFAULT '',
  state text NOT NULL DEFAULT 'normal',
  google_calendar_id text,
  google_calendar_event_id text,
  google_meet_url text,
  google_calendar_status text DEFAULT 'pending',
  google_calendar_error text DEFAULT '',
  google_calendar_synced_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, session_index)
);

-- sessions 누락 필드 안전 추가
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'google_meet_url') THEN
    ALTER TABLE public.sessions ADD COLUMN google_meet_url text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'google_calendar_id') THEN
    ALTER TABLE public.sessions ADD COLUMN google_calendar_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'google_calendar_event_id') THEN
    ALTER TABLE public.sessions ADD COLUMN google_calendar_event_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sessions' AND column_name = 'version') THEN
    ALTER TABLE public.sessions ADD COLUMN version int NOT NULL DEFAULT 1;
  END IF;
END;
$$;

-- sessions 테이블 트리거 설정
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sessions_occ_version'
  ) THEN
    CREATE TRIGGER trg_sessions_occ_version
    BEFORE UPDATE ON public.sessions
    FOR EACH ROW EXECUTE FUNCTION public.increment_version_and_touch_updated_at();
  END IF;
END;
$$;

-- 4. RLS(Row Level Security) 설정
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'students_read_authenticated'
  ) THEN
    CREATE POLICY students_read_authenticated ON public.students FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'students' AND policyname = 'students_write_authenticated'
  ) THEN
    CREATE POLICY students_write_authenticated ON public.students FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname = 'sessions_read_authenticated'
  ) THEN
    CREATE POLICY sessions_read_authenticated ON public.sessions FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sessions' AND policyname = 'sessions_write_authenticated'
  ) THEN
    CREATE POLICY sessions_write_authenticated ON public.sessions FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
