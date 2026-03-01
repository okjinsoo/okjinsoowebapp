# 모니터링/알림 설정 (초보용)

이 문서는 "오류가 나면 내가 어디서 보고, 메일을 받을 수 있는지"를 빠르게 정리한 안내입니다.

## 1) Sentry 이메일 알림 켜기 (가장 중요)

### A. Sentry 프로젝트 만들기

1. [https://sentry.io](https://sentry.io) 로그인
2. `Create Project` 클릭
3. 플랫폼은 `Next.js` 선택
4. 프로젝트 이름 입력 (예: `okjinsoo-webapp`)
5. 생성 후 `DSN` 값을 복사

### B. Vercel 환경변수 넣기

1. Vercel 프로젝트 열기
2. `Settings` -> `Environment Variables`
3. 아래 2개를 추가:
   - `NEXT_PUBLIC_SENTRY_DSN` = 복사한 DSN
   - `SENTRY_DSN` = 같은 DSN (서버용)
4. `Production` 환경에 저장
5. 배포 재실행(또는 `main`에 새 커밋 푸시)

### C. 메일 알림 규칙 만들기

1. Sentry -> 해당 프로젝트 -> `Alerts`
2. `Create Alert Rule`
3. 조건: `Issue is created` (새 오류 발생)
4. 액션: `Send a notification via Email`
5. 본인 이메일 선택 후 저장

> 이 단계까지 끝나면, 새 오류가 올라올 때 이메일이 옵니다.

## 2) Vercel Logs 보는 위치

1. Vercel 프로젝트 -> `Deployments`
2. 최근 배포 클릭
3. `Functions` 또는 `Logs` 탭 확인

언제 보나:
- API 오류(`500`, `401`, `403`)가 갑자기 늘 때
- 배포 직후 기능이 안 될 때

## 3) Supabase Logs 보는 위치

1. Supabase 프로젝트 -> `Logs Explorer`
2. `Auth`, `Postgres`, `API` 카테고리 필터

언제 보나:
- 로그인/권한 문제
- SQL/정책(RLS) 관련 오류
- snapshot upsert/fetch 실패

## 4) 주간 점검(일요일)

1. 이메일 변경 테스트 1건
2. 회차 동기화 1회
3. Vercel 로그 최근 24시간 확인
4. Supabase 로그 최근 24시간 확인
5. Sentry `Issues`에서 신규 오류 확인

## 5) 메일이 안 올 때 체크

1. DSN 환경변수가 Vercel `Production`에 들어갔는지
2. 배포가 새로 되었는지
3. Sentry 알림 규칙(이메일 액션)이 켜져 있는지
4. Sentry 프로젝트가 맞는지(다른 프로젝트를 보고 있지 않은지)
