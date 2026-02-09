-- 브라우저 localStorage(학생/선생님) 공유용 스냅샷 테이블
-- 목적:
-- - 관리자/선생님/학생 계정이 다른 브라우저로 로그인해도 동일 목록을 불러오도록 지원

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_state_snapshots (
  id text PRIMARY KEY,
  teachers jsonb NOT NULL DEFAULT '[]'::jsonb,
  students jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_app_state_snapshots_updated_at'
  ) THEN
    CREATE TRIGGER trg_app_state_snapshots_updated_at
    BEFORE UPDATE ON public.app_state_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END;
$$;

ALTER TABLE public.app_state_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_state_snapshots'
      AND policyname = 'app_state_snapshots_read_all_authenticated'
  ) THEN
    CREATE POLICY app_state_snapshots_read_all_authenticated
    ON public.app_state_snapshots
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_state_snapshots'
      AND policyname = 'app_state_snapshots_write_all_authenticated'
  ) THEN
    CREATE POLICY app_state_snapshots_write_all_authenticated
    ON public.app_state_snapshots
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_state_snapshots'
      AND policyname = 'app_state_snapshots_update_all_authenticated'
  ) THEN
    CREATE POLICY app_state_snapshots_update_all_authenticated
    ON public.app_state_snapshots
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END;
$$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.app_state_snapshots TO authenticated;

COMMIT;
