# TutorWEB 배포용 DB 최소 스키마 템플릿 (v1)

작성일: 2026-02-05  
목적: Next.js + Vercel + Postgres 기준, 운영 사고를 줄이는 최소 설계안

## 0) 고정 원칙
- 기본 거부(deny by default): 명시 허용 외 전부 403
- 민감정보 최소화: 비밀번호 평문 저장 금지, 로그 마스킹
- soft delete 우선: 실제 삭제 대신 `status/hidden_at/disabled_at`
- 감사로그 불변: `audit_logs`는 앱 레벨 update/delete 금지

---

## 1) 테이블 템플릿 (최소)

### 1-1. users
- 용도: 로그인 계정
- 컬럼:
  - `id uuid pk`
  - `email text not null unique`
  - `password_hash text not null`
  - `role text not null check (role in ('a','t','s'))`
  - `status text not null default 'active' check (status in ('active','suspended','pending'))`
  - `lock_until timestamptz null`
  - `failed_login_count int not null default 0`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

인덱스:
- `unique(email)`
- `idx_users_role(role)`

---

### 1-2. auth_sessions
- 용도: 세션 저장소(서버 메모리 금지)
- 컬럼:
  - `id uuid pk` (세션 id)
  - `user_id uuid not null fk -> users(id)`
  - `expires_at timestamptz not null`
  - `revoked_at timestamptz null`
  - `ip text null`
  - `user_agent text null`
  - `created_at timestamptz not null default now()`

인덱스:
- `idx_auth_sessions_user(user_id)`
- `idx_auth_sessions_expires(expires_at)`

---

### 1-3. teachers
- 컬럼:
  - `id uuid pk`
  - `user_id uuid unique null fk -> users(id)` (로그인 계정 연결)
  - `name text not null`
  - `phone text null`
  - `email text null`
  - `work_start_date date null`
  - `active boolean not null default true`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

인덱스:
- `idx_teachers_active(active)`

---

### 1-4. students
- 컬럼:
  - `id uuid pk`
  - `user_id uuid unique null fk -> users(id)` (학생 로그인 계정 연결)
  - `name text not null`
  - `cohort text not null`
  - `status text not null check (status in ('new','active','need_extension','overdue_extension','pause_requested','pause_scheduled','paused'))`
  - `start_date date not null`
  - `plan_count int not null check (plan_count > 0)`
  - `google_email text null`
  - `student_phone text null`
  - `parent_phone text null`
  - `school text null`
  - `grade text null`
  - `gender text null check (gender in ('male','female') or gender is null)`
  - `parent_role text null check (parent_role in ('father','mother') or parent_role is null)`
  - `pause_effective_date date null`
  - `pause_status text null check (pause_status in ('none','confirmed','paused') or pause_status is null)`
  - `hidden_at timestamptz null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

인덱스:
- `idx_students_status(status)`
- `idx_students_cohort(cohort)`

---

### 1-5. teacher_students (담당 관계 강제)
- 컬럼:
  - `teacher_id uuid not null fk -> teachers(id)`
  - `student_id uuid not null fk -> students(id)`
  - `active boolean not null default true`
  - `created_at timestamptz not null default now()`

제약:
- `primary key (teacher_id, student_id)`
- `unique (teacher_id, student_id)` (중복 배정 방지)

인덱스:
- `idx_teacher_students_student(student_id)`

---

### 1-6. sessions
- 컬럼:
  - `id uuid pk`
  - `student_id uuid not null fk -> students(id)`
  - `index_no int not null check (index_no > 0)`
  - `display_at timestamptz not null`
  - `state text not null check (state in ('normal','changed','carried','absent'))`
  - `status text not null default 'scheduled' check (status in ('scheduled','completed','canceled'))`
  - `hidden_at timestamptz null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

제약:
- `unique (student_id, index_no)`

인덱스:
- `idx_sessions_student(student_id, index_no)`
- `idx_sessions_display_at(display_at)`
- `idx_sessions_hidden(hidden_at)`

---

### 1-7. session_meta
- 컬럼:
  - `id uuid pk`
  - `student_id uuid not null fk -> students(id)`
  - `session_index int not null`
  - `status text null check (status in ('planned','present','absent') or status is null)`
  - `override_date date null`
  - `override_hour int null`
  - `override_minute int null`
  - `carry_to_index int null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

제약:
- `unique(student_id, session_index)`

---

### 1-8. consultations
- 컬럼:
  - `id uuid pk`
  - `student_id uuid not null fk -> students(id)`
  - `date date not null`
  - `purpose text not null check (purpose in ('general','pause_request','extension'))`
  - `target text not null check (target in ('student','parent'))`
  - `content text not null`
  - `admin_consult_date date null`
  - `extension_result text null check (extension_result in ('extended','not_extended') or extension_result is null)`
  - `extension_payment_date date null`
  - `extension_added_count int null`
  - `extension_payment_confirmed boolean null`
  - `final_note text null`
  - `final_result text null check (final_result in ('pause_cancel','pause_confirm') or final_result is null)`
  - `pause_effective_date date null`
  - `pause_refund_ratio text null check (pause_refund_ratio in ('full','two_thirds','half','none') or pause_refund_ratio is null)`
  - `pause_refund_completed boolean null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

인덱스:
- `idx_consultations_student(student_id, created_at desc)`
- `idx_consultations_purpose(purpose, date)`

---

### 1-9. payments
- 컬럼:
  - `id uuid pk`
  - `student_id uuid not null fk -> students(id)`
  - `payment_date date not null`
  - `added_count int not null check (added_count >= 0)`
  - `start_index int not null`
  - `end_index int not null`
  - `memo text null`
  - `refund_status text null check (refund_status in ('requested','completed') or refund_status is null)`
  - `refund_session_index int null`
  - `refund_ratio text null check (refund_ratio in ('full','two_thirds','half','none') or refund_ratio is null)`
  - `refund_reason text null`
  - `refund_requested_at timestamptz null`
  - `refund_processed_at timestamptz null`
  - `refund_processed_date date null`
  - `refund_consult_note text null`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

인덱스:
- `idx_payments_student(student_id, created_at desc)`
- `idx_payments_refund_status(refund_status)`

---

### 1-10. audit_logs
- 컬럼:
  - `id uuid pk`
  - `actor_user_id uuid null fk -> users(id)`
  - `action text not null` (예: `SESSION_HIDE`, `PAYMENT_APPEND`, `CONSULT_UPDATE`)
  - `target_type text not null` (예: `student`, `session`, `payment`, `consultation`)
  - `target_id uuid not null`
  - `before_json jsonb null` (민감정보 마스킹 후 저장)
  - `after_json jsonb null` (민감정보 마스킹 후 저장)
  - `ip text null`
  - `created_at timestamptz not null default now()`

인덱스:
- `idx_audit_actor(actor_user_id, created_at desc)`
- `idx_audit_target(target_type, target_id, created_at desc)`

운영 규칙:
- 앱 레벨에서 `audit_logs` 수정/삭제 API 제공 금지

---

## 2) 삭제 정책(권장)
- `users/teachers/students/sessions`는 hard delete 금지
- `status`, `active`, `hidden_at`, `disabled_at`로 상태 전환
- 실제 hard delete는 백오피스/DBA 승인 작업으로만 처리

---

## 3) 마이그레이션 검증 숫자(필수)
Export vs Import 후 DB 카운트 일치 확인:
- 학생 수
- 선생 수
- 회차 수
- 결제 이벤트 수
- 상담 이벤트 수

불일치 시 배포 중단.

