-- role_bindings 권한/보안 보강
-- 목적:
-- 1) authenticated 기본 권한을 명시적으로 부여
-- 2) set_updated_at 함수 search_path 경고 완화

BEGIN;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.role_bindings') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_bindings TO authenticated';
  END IF;
END;
$$;

COMMIT;
