-- Google 로그인 이메일 기반 권한 매핑
-- admin은 코드 고정 이메일(rapah0310@gmail.com), student/teacher는 이 테이블로 판별

BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS role_bindings (
  email text PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('student', 'teacher')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_bindings_role ON role_bindings(role);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_role_bindings_updated_at') THEN
    CREATE TRIGGER trg_role_bindings_updated_at
    BEFORE UPDATE ON role_bindings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

ALTER TABLE role_bindings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_bindings'
      AND policyname = 'role_bindings_select_own'
  ) THEN
    CREATE POLICY role_bindings_select_own
    ON role_bindings
    FOR SELECT
    TO authenticated
    USING (lower(email) = lower(coalesce(auth.jwt()->>'email', '')));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'role_bindings'
      AND policyname = 'role_bindings_admin_manage'
  ) THEN
    CREATE POLICY role_bindings_admin_manage
    ON role_bindings
    FOR ALL
    TO authenticated
    USING (lower(coalesce(auth.jwt()->>'email', '')) = 'rapah0310@gmail.com')
    WITH CHECK (lower(coalesce(auth.jwt()->>'email', '')) = 'rapah0310@gmail.com');
  END IF;
END;
$$;

COMMIT;
