BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_state_snapshots'
      AND policyname = 'app_state_snapshots_write_all_authenticated'
  ) THEN
    DROP POLICY app_state_snapshots_write_all_authenticated ON public.app_state_snapshots;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_state_snapshots'
      AND policyname = 'app_state_snapshots_update_all_authenticated'
  ) THEN
    DROP POLICY app_state_snapshots_update_all_authenticated ON public.app_state_snapshots;
  END IF;
END;
$$;

CREATE POLICY app_state_snapshots_write_main_authenticated
ON public.app_state_snapshots
FOR INSERT
TO authenticated
WITH CHECK (id = 'main');

CREATE POLICY app_state_snapshots_update_main_authenticated
ON public.app_state_snapshots
FOR UPDATE
TO authenticated
USING (id = 'main')
WITH CHECK (id = 'main');

COMMIT;
