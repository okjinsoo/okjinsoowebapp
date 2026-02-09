# Supabase + Google 로그인 설정 가이드

이 문서는 초보자 기준으로, "옥진수학 웹앱에서 구글 로그인 + 권한 분기"를 붙이는 순서를 설명합니다.

## 1) 먼저 이해할 것

- 로그인 버튼을 누르면 Google 화면으로 이동합니다.
- Google에서 로그인 성공하면 다시 우리 앱(`/auth/callback`)으로 돌아옵니다.
- 돌아온 뒤 토큰을 저장하고 홈(`/`)으로 이동합니다.
- 권한은 아래 규칙으로 결정됩니다.
  - 관리자: 코드에 고정된 이메일(`rapah0310@gmail.com`)
  - 선생님/학생: Supabase `role_bindings` 테이블

## 2) Supabase 프로젝트 만들기

1. [Supabase](https://supabase.com/)에 로그인
2. `New project` 생성
3. 프로젝트 생성 완료 후 `Project Settings > API`에서 아래 2개를 복사
- `Project URL` (예: `https://YOUR_PROJECT_REF.supabase.co`)
- `anon public key`

## 3) role_bindings 테이블 만들기 (중요)

1. Supabase 프로젝트 > `SQL Editor` 이동
2. 저장소 파일 `db/migrations/002_role_bindings.sql` 내용을 붙여넣고 `Run`
3. 이어서 `db/migrations/003_role_bindings_hardening.sql`도 붙여넣고 `Run`
4. 이어서 `db/migrations/004_shared_snapshot.sql`도 붙여넣고 `Run`
5. `Table Editor`에서 `role_bindings`, `app_state_snapshots` 테이블 생성 확인

이 테이블은 로그인 이메일과 권한(`student`/`teacher`)을 연결합니다.

## 4) Google OAuth 앱 만들기

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 생성
3. `APIs & Services > OAuth consent screen` 설정
4. `APIs & Services > Credentials > Create Credentials > OAuth client ID`
5. `Authorized redirect URI`에 아래 주소 추가
- `https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback`

## 5) Supabase에서 Google Provider 켜기

1. Supabase 프로젝트 > `Authentication > Providers > Google`
2. Google에서 만든 `Client ID`, `Client Secret` 입력
3. `Save`

## 6) Supabase URL 설정

Supabase 프로젝트 > `Authentication > URL Configuration`

- `Site URL`
- 로컬: `http://localhost:3000`
- 배포: `https://<YOUR_VERCEL_DOMAIN>`

- `Redirect URLs` (둘 다 추가 권장)
- `http://localhost:3000/auth/callback`
- `https://<YOUR_VERCEL_DOMAIN>/auth/callback`

## 7) 로컬 환경변수 설정

루트 폴더에 `.env.local` 파일을 만들고 다음 값 넣기:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

- 관리자 기본 이메일은 코드에 고정: `lib/auth/roleAuth.ts`
- 선생님 추가/수정/삭제 시 `role_bindings`가 자동 동기화됩니다.
- 학생 추가/수정/삭제 시 `role_bindings`가 자동 동기화됩니다.
- 선생님/학생 목록(localStorage)은 `app_state_snapshots`로도 동기화됩니다.
  - 다른 브라우저/계정에서 로그인해도 목록을 불러올 수 있습니다.

## 8) 로컬 테스트

```bash
npm run dev
```

1. 홈(`/`) 접속
2. `구글로 로그인하기` 클릭
3. 로그인 후 홈에서 권한 배지 확인
4. 관리자에서 선생님/학생 이메일을 변경한 뒤, 다시 홈에서 이동 버튼(`관리자/선생님/학생`) 확인

## 9) Vercel 배포 시 설정

Vercel 프로젝트 > `Settings > Environment Variables`

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

배포 후에도 반드시 Supabase `Redirect URLs`에 배포 도메인이 들어가 있어야 합니다.

## 10) 지금 구현의 범위

- 구글 로그인 시작/복귀/세션 저장
- 이메일 기반 권한 분기(관리자/선생님/학생)
- 경로 보호(`/a`,`/t`,`/s`)
- 권한 소스:
  - 관리자: 고정 이메일(`rapah0310@gmail.com`)
  - 선생님/학생: Supabase `role_bindings` 테이블
