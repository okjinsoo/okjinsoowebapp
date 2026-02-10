BEGIN;

ALTER TABLE public.app_state_snapshots
ADD COLUMN IF NOT EXISTS state_kv jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
