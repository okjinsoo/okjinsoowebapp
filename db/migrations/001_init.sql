-- TutorWEB v1 initial schema (Postgres)
-- 작성일: 2026-02-05
-- 목적: localStorage 기반 데이터를 DB(Postgres)로 옮기기 위한 최소 운영 스키마

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('a', 't', 's')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
  lock_until timestamptz,
  failed_login_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS teachers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text,
  email text,
  work_start_date date,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_teachers_active ON teachers(active);

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL,
  cohort text NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'new',
      'active',
      'need_extension',
      'overdue_extension',
      'pause_requested',
      'pause_scheduled',
      'paused'
    )
  ),
  start_date date NOT NULL,
  plan_count int NOT NULL CHECK (plan_count > 0),
  google_email text,
  student_phone text,
  parent_phone text,
  school text,
  grade text,
  gender text CHECK (gender IN ('male', 'female') OR gender IS NULL),
  parent_role text CHECK (parent_role IN ('father', 'mother') OR parent_role IS NULL),
  pause_effective_date date,
  pause_status text CHECK (pause_status IN ('none', 'confirmed', 'paused') OR pause_status IS NULL),
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);
CREATE INDEX IF NOT EXISTS idx_students_cohort ON students(cohort);

CREATE TABLE IF NOT EXISTS teacher_students (
  teacher_id uuid NOT NULL REFERENCES teachers(id) ON DELETE RESTRICT,
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (teacher_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_students_student ON teacher_students(student_id);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  index_no int NOT NULL CHECK (index_no > 0),
  display_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('normal', 'changed', 'carried', 'absent')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'canceled')),
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, index_no)
);

CREATE INDEX IF NOT EXISTS idx_sessions_student_index ON sessions(student_id, index_no);
CREATE INDEX IF NOT EXISTS idx_sessions_display_at ON sessions(display_at);
CREATE INDEX IF NOT EXISTS idx_sessions_hidden ON sessions(hidden_at);

CREATE TABLE IF NOT EXISTS session_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  session_index int NOT NULL CHECK (session_index > 0),
  status text CHECK (status IN ('planned', 'present', 'absent') OR status IS NULL),
  override_date date,
  override_hour int CHECK (override_hour BETWEEN 0 AND 23 OR override_hour IS NULL),
  override_minute int CHECK (override_minute IN (0, 30) OR override_minute IS NULL),
  carry_to_index int CHECK (carry_to_index > 0 OR carry_to_index IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, session_index)
);

CREATE TABLE IF NOT EXISTS consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  date date NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('general', 'pause_request', 'extension')),
  target text NOT NULL CHECK (target IN ('student', 'parent')),
  content text NOT NULL,
  admin_consult_date date,
  extension_result text CHECK (extension_result IN ('extended', 'not_extended') OR extension_result IS NULL),
  extension_payment_date date,
  extension_added_count int CHECK (extension_added_count >= 0 OR extension_added_count IS NULL),
  extension_payment_confirmed boolean,
  final_note text,
  final_result text CHECK (final_result IN ('pause_cancel', 'pause_confirm') OR final_result IS NULL),
  pause_effective_date date,
  pause_refund_ratio text CHECK (pause_refund_ratio IN ('full', 'two_thirds', 'half', 'none') OR pause_refund_ratio IS NULL),
  pause_refund_completed boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultations_student_created ON consultations(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_purpose_date ON consultations(purpose, date);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  payment_date date NOT NULL,
  added_count int NOT NULL CHECK (added_count >= 0),
  start_index int NOT NULL CHECK (start_index > 0),
  end_index int NOT NULL CHECK (end_index > 0),
  memo text,
  refund_status text CHECK (refund_status IN ('requested', 'completed') OR refund_status IS NULL),
  refund_session_index int CHECK (refund_session_index > 0 OR refund_session_index IS NULL),
  refund_ratio text CHECK (refund_ratio IN ('full', 'two_thirds', 'half', 'none') OR refund_ratio IS NULL),
  refund_reason text,
  refund_requested_at timestamptz,
  refund_processed_at timestamptz,
  refund_processed_date date,
  refund_consult_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_index >= start_index)
);

CREATE INDEX IF NOT EXISTS idx_payments_student_created ON payments(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_refund_status ON payments(refund_status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  before_json jsonb,
  after_json jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_actor_created ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_created ON audit_logs(target_type, target_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_teachers_updated_at') THEN
    CREATE TRIGGER trg_teachers_updated_at
    BEFORE UPDATE ON teachers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_students_updated_at') THEN
    CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_sessions_updated_at') THEN
    CREATE TRIGGER trg_sessions_updated_at
    BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_session_meta_updated_at') THEN
    CREATE TRIGGER trg_session_meta_updated_at
    BEFORE UPDATE ON session_meta
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_consultations_updated_at') THEN
    CREATE TRIGGER trg_consultations_updated_at
    BEFORE UPDATE ON consultations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_payments_updated_at') THEN
    CREATE TRIGGER trg_payments_updated_at
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END
$$;

COMMIT;
