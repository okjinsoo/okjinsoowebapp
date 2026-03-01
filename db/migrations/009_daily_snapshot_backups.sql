-- v1/db/migrations/009_daily_snapshot_backups.sql
-- 목적: app_state_snapshots(main) 내용을 날짜별 백업 테이블에 적재

CREATE TABLE IF NOT EXISTS public.app_state_snapshot_backups (
  id text PRIMARY KEY,
  snapshot_id text NOT NULL DEFAULT 'main',
  backup_date date NOT NULL,
  source text NOT NULL DEFAULT 'daily_cron',
  teachers jsonb NOT NULL DEFAULT '[]'::jsonb,
  students jsonb NOT NULL DEFAULT '[]'::jsonb,
  sessions jsonb NOT NULL DEFAULT '[]'::jsonb,
  state_kv jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS app_state_snapshot_backups_snapshot_date_uidx
  ON public.app_state_snapshot_backups (snapshot_id, backup_date);

ALTER TABLE public.app_state_snapshot_backups ENABLE ROW LEVEL SECURITY;

-- 서비스 키(server role) 호출 기준. 일반 사용자/클라이언트는 접근 불가.
-- service_role은 BYPASSRLS로 동작하지만, 명시 정책도 함께 둡니다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_state_snapshot_backups'
      AND policyname = 'app_state_snapshot_backups_service_role_all'
  ) THEN
    CREATE POLICY app_state_snapshot_backups_service_role_all
    ON public.app_state_snapshot_backups
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON TABLE public.app_state_snapshot_backups TO service_role;

