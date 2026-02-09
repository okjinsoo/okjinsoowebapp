# Supabase + Google 로그인 설정 가이드

이 문서는 초보자 기준으로, "옥진수학 웹앱에서 구글 로그인"을 붙이는 순서를 설명합니다.

## 1) 먼저 이해할 것

- 로그인 버튼을 누르면 Google 화면으로 이동합니다.
- Google에서 로그인 성공하면 다시 우리 앱(`/auth/callback`)으로 돌아옵니다.
- 돌아온 뒤 토큰을 저장하고 홈(`/`)으로 이동합니다.

## 2) Supabase 프로젝트 만들기

1. [Supabase](https://supabase.com/)에 로그인
2. `New project` 생성
3. 프로젝트 생성 완료 후 `Project Settings > API`에서 아래 2개를 복사
- `Project URL` (예: `https://YOUR_PROJECT_REF.supabase.co`)
- `anon public key`

## 3) Google OAuth 앱 만들기

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 생성
3. `APIs & Services > OAuth consent screen` 설정
4. `APIs & Services > Credentials > Create Credentials > OAuth client ID`
5. `Authorized redirect URI`에 아래 주소 추가
- `https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback`

## 4) Supabase에서 Google Provider 켜기

1. Supabase 프로젝트 > `Authentication > Providers > Google`
2. Google에서 만든 `Client ID`, `Client Secret` 입력
3. `Save`

## 5) Supabase URL 설정

Supabase 프로젝트 > `Authentication > URL Configuration`

- `Site URL`
- 로컬: `http://localhost:3000`
- 배포: `https://<YOUR_VERCEL_DOMAIN>`

- `Redirect URLs` (둘 다 추가 권장)
- `http://localhost:3000/auth/callback`
- `https://<YOUR_VERCEL_DOMAIN>/auth/callback`

## 6) 로컬 환경변수 설정

루트 폴더에 `.env.local` 파일을 만들고 다음 값 넣기:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
NEXT_PUBLIC_ADMIN_EMAILS=owner@gmail.com
NEXT_PUBLIC_TEACHER_EMAILS=teacher1@gmail.com,teacher2@gmail.com
```

- `NEXT_PUBLIC_ADMIN_EMAILS`: 관리자 권한으로 로그인 허용할 이메일 목록
- `NEXT_PUBLIC_TEACHER_EMAILS`: 선생님 권한으로 로그인 허용할 이메일 목록
- 위 2개 목록에 없는 이메일은 자동으로 학생 권한으로 처리됩니다.

## 7) 로컬 테스트

```bash
npm run dev
```

1. 홈(`/`) 접속
2. `구글로 로그인하기` 클릭
3. 로그인 후 다시 홈으로 오면 성공

## 8) Vercel 배포 시 설정

Vercel 프로젝트 > `Settings > Environment Variables`

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_ADMIN_EMAILS`
- `NEXT_PUBLIC_TEACHER_EMAILS`

배포 후에도 반드시 Supabase `Redirect URLs`에 배포 도메인이 들어가 있어야 합니다.

## 9) 지금 구현의 범위

- 현재는 "로그인 시작/복귀/사용자 이메일 확인"까지 구현되어 있습니다.
- 이메일 기반 권한 분기(관리자/선생님/학생) + 경로 보호(`/a`,`/t`,`/s`)가 적용되어 있습니다.
- 네트워크 제한 때문에 Supabase SDK 설치는 못 했고, REST 방식으로 연결했습니다.
