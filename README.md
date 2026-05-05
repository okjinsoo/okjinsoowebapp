# TutorWEB v1 (옥진수학)

옥진수학의 관리자(a) / 선생님(t) / 학생(s) 권한 기반 수업 관리 웹앱입니다.

핵심 목표:
- 구글 로그인으로 빠르게 접속
- 역할별 화면 분리 (`/a`, `/t`, `/s`)
- 학생/선생님/회차/상담 데이터를 로컬 + Supabase 스냅샷으로 동기화

## 1) 기술 스택

- Next.js 16 (App Router)
- React 19
- TypeScript (strict)
- Tailwind CSS v4
- Supabase (Auth + PostgREST)
- Vitest, ESLint

## 2) 빠른 시작

### 2-1. 설치

```bash
npm install
```

### 2-2. 환경변수 설정

`.env.local`을 만들고 아래 값을 넣어주세요.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
AUTH_BRIDGE_COOKIE_SECRET=SET_A_LONG_RANDOM_SECRET_FOR_AUTH_BRIDGE
CRON_BACKUP_SECRET=SET_A_LONG_RANDOM_SECRET
```

참고:
- `CRON_BACKUP_SECRET`은 일일 백업 API 보호용입니다.
- `AUTH_BRIDGE_COOKIE_SECRET`은 브리지 쿠키 위변조 방지(HMAC 서명)용입니다.
- 코드에서는 `CRON_SECRET`도 fallback으로 읽습니다.

### 2-3. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

### 2-4. 운영과 분리된 테스트 서버 실행 (권장)

```bash
cp env.sandbox.example .env.local.sandbox
```

`.env.local.sandbox`에 **운영과 다른 Supabase 프로젝트 키**를 넣은 뒤 실행하세요.

```bash
npm run dev:isolated
```

브라우저에서 `http://localhost:4100` 접속

추가:
- 분리 모드 홈에서 `로컬 테스트용 관리자 바로 로그인` 버튼을 사용할 수 있습니다.
- 이 버튼은 `TUTORWEB_ISOLATED=1`일 때만 동작하며, 운영 서버에서는 비활성화됩니다.
- 분리 모드 기본값은 `로컬 전용 저장`입니다. (`TUTORWEB_LOCAL_ONLY=1`)
- 즉, 테스트 서버(4100)에서 데이터 수정 시 Supabase 서버에 쓰지 않고 브라우저 로컬에만 저장합니다.

## 3) 주요 명령어

```bash
npm run dev       # 개발 서버
npm run dev:isolated # 운영과 분리된 테스트 서버(기본 4100)
npm run build     # 프로덕션 빌드
npm run start     # 프로덕션 실행
npm run lint      # ESLint
npm test          # Vitest watch
npm run test:run  # Vitest 1회 실행
```

## 4) 폴더 구조

```text
app/                  # App Router 페이지 + API 라우트
  api/                # 내부 API
  a/ t/ s/            # 역할별 화면
lib/
  auth/               # 로그인/권한 처리
  server/             # 서버 전용 Supabase 접근
  storage/            # 로컬 저장 + 공유 스냅샷 동기화
  ui/                 # 공용/역할별 UI
db/migrations/        # Supabase SQL 마이그레이션
docs/                 # 운영/배포/체크리스트 문서
```

## 5) 라우트 개요

### 페이지

- `/` 홈/로그인
- `/auth/callback` OAuth 복귀
- `/a/*` 관리자
- `/t/*` 선생님
- `/s/*` 학생
- `/policy`
- `/lib/lectures`

### API

- `/api/auth/bridge` (브리지 쿠키 동기화)
- `/api/auth/me`
- `/api/snapshot`
- `/api/students`
- `/api/students/[id]/sessions`
- `/api/students/[id]/consultations`
- `/api/teachers`
- `/api/ops/backup/daily`

## 6) 권한 규칙(요약)

- 관리자: 코드에 고정된 이메일(`rapah0310@gmail.com`)
- 선생님/학생: `role_bindings` + 스냅샷 fallback
- 경로 보호:
  - 미들웨어: `/a`, `/t`, `/s` 1차 차단
  - 클라이언트 가드: `RoleRouteGuard`로 2차 확인
  - API: `resolveViewerContext`로 최종 권한 확인

## 7) 운영 문서

- [Supabase + Google 로그인 설정](docs/supabase-google-login-setup.md)
- [일일 자동 백업 설정](docs/daily-backup-setup.md)
- [수동 회귀 테스트 체크리스트](docs/manual-regression-checklist.md)
- [인증 보안 우선순위](docs/auth-security-priority-2026-03-21.md)

## 8) 현재 주의사항

- 기본 `README`를 실제 구조에 맞게 갱신한 상태입니다.
- 인증 보안 개선 우선순위는 `docs/auth-security-priority-2026-03-21.md`에 정리되어 있습니다.
- `docs/api-auth-matrix.md`는 일부 엔드포인트가 현재 코드와 다를 수 있어, 다음 리팩터링 때 동기화가 필요합니다.
