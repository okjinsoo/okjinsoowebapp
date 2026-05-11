# TutorWEB v1 (옥진수학)

옥진수학 운영용 수업 관리 웹앱입니다.
- 관리자(`a`) / 선생님(`t`) / 학생(`s`) 역할별 화면
- Google 로그인 + 권한 기반 접근 제어
- 학생/선생님/회차 데이터를 서버(Supabase) 기준으로 동기화

## 1. 현재 운영 기준

- 최신 운영 기준 문서: `docs/project-status-latest.md`
- 운영 주소: `https://okjinsoowebapp.vercel.app`
- 관리자 고정 이메일: `rapah0310@gmail.com`

## 2. 기술 스택

- Next.js 16 (App Router)
- React 19
- TypeScript (strict)
- Tailwind CSS v4
- Supabase (Auth + PostgREST)
- ESLint, Vitest

## 3. 빠른 시작

### 3-1. 설치

```bash
npm install
```

### 3-2. 환경변수

`.env.local` 파일을 만들고 아래 값을 넣습니다.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
AUTH_BRIDGE_COOKIE_SECRET=SET_A_LONG_RANDOM_SECRET_FOR_AUTH_BRIDGE
CRON_BACKUP_SECRET=SET_A_LONG_RANDOM_SECRET

# Google Sheets 관리자 OAuth (학습 현황 동기화)
GOOGLE_SHEETS_OAUTH_CLIENT_ID=...
# 선택: 클라이언트가 secret을 발급하는 타입이면 입력
GOOGLE_SHEETS_OAUTH_CLIENT_SECRET=...
GOOGLE_SHEETS_OAUTH_REFRESH_TOKEN=...
GOOGLE_SHEETS_OWNER_EMAIL=...
GOOGLE_SHEETS_PARENT_FOLDER_ID=...

# 선택: 시트 메뉴(Apps Script) 호출 보호
LEARNING_SHEET_MENU_SECRET=SET_A_LONG_RANDOM_SECRET
# 선택: 주간 학습시트 크론 전용 키 (미설정 시 CRON_BACKUP_SECRET 사용)
CRON_LEARNING_SHEET_SECRET=...
```

설명:
- `AUTH_BRIDGE_COOKIE_SECRET`: 브리지 쿠키 서명 키
- `CRON_BACKUP_SECRET`: 일일 백업 API 보호 키
- `GOOGLE_SHEETS_*`: 관리자 OAuth 기반 학습시트 동기화 키
- `LEARNING_SHEET_MENU_SECRET`: 시트 상단 메뉴 연동 웹훅 보호 키

### 3-3. 개발 서버

```bash
npm run dev
```

- 접속: `http://localhost:3000`

### 3-4. 운영과 분리된 테스트 서버(권장)

```bash
cp env.sandbox.example .env.local.sandbox
npm run dev:isolated
```

- 접속: `http://localhost:4100`
- 분리 모드는 기본적으로 로컬 전용 저장(`TUTORWEB_LOCAL_ONLY=1`)을 사용합니다.

## 4. 주요 명령어

```bash
npm run dev           # 개발 서버
npm run dev:isolated  # 운영 분리 테스트 서버(기본 4100)
npm run build         # 프로덕션 빌드
npm run start         # 프로덕션 실행
npm run lint          # 정적 검사
npm run test          # 테스트 watch
npm run test:run      # 테스트 1회 실행
```

## 5. 라우트 개요

### 페이지

- `/` 홈/로그인
- `/auth/callback` OAuth 복귀
- `/auth/reauth` Google 재인증 안내/진입
- `/a/*` 관리자
- `/t/*` 선생님
- `/s/*` 학생
- `/lib/lectures` 강의 저장소
- `/policy`

### API

- `/api/auth/bridge`
- `/api/auth/local-admin` (분리 모드 로컬 관리자 진입)
- `/api/auth/me`
- `/api/snapshot`
- `/api/students`
- `/api/students/[id]/sessions`
- `/api/teachers`
- `/api/ops/backup/daily`
- `/api/ops/learning-sheet/sync`
- `/api/ops/learning-sheet/weekly`
- `/api/ops/learning-sheet/sync-by-sheet`

## 6. 권한/보안 요약

- 경로 1차 보호: `proxy.ts`
- 클라이언트 2차 보호: 역할 가드
- API 최종 보호: 서버 권한 컨텍스트 검증
- Google Calendar/Drive `401` 발생 시 자동 재인증 흐름을 사용합니다.

## 7. 폴더 구조

```text
app/                  # 페이지 + API 라우트
lib/                  # 인증/스토리지/도메인 로직/UI
db/migrations/        # Supabase 마이그레이션
docs/                 # 운영 문서
scripts/              # 보조 실행 스크립트
```

## 8. 운영 체크

배포 전 기본 순서:
1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

운영 변경/배포 후:
- `docs/project-status-latest.md`를 즉시 업데이트합니다.
