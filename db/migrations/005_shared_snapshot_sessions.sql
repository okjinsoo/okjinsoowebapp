BEGIN;

ALTER TABLE public.app_state_snapshots
ADD COLUMN IF NOT EXISTS sessions jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
