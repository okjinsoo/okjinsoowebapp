# Project Status (Latest)

기준 시각: 2026-05-08 04:04 (KST)
대상 프로젝트: `v1`

## 1분 요약

- 최신 운영 반영본: 2026-05-07 17:26 (KST), `dpl_5AuCDsWmHoEVbeBBSCW8GALK2cF3`
- 운영 주소: `https://okjinsoowebapp.vercel.app`
- 관리자 `tmain`을 `teacherToken/studentToken` 기반 경로로 재정비하고, 구경로는 호환 리다이렉트로 유지
- 인증/권한 보호 체계(브리지 쿠키 + 경로가드 + API 권한검증) 정비 완료
- Google Calendar/Drive `401` 자동 복구 + `next` 복귀 + 중복 알림 억제(dedupe) 적용
- 회차 운영은 담당 선생님 소유권 기준, 비소유자 변경 시 `pending` 재동기화 정책 유지
- 학생 상세에 백업/복원(복원은 로컬 테스트 모드 전용), 회차 정합성 자동 복구/분리보정 기능 반영

## 현재 고정 운영 정책

1. 관리자 정책
- 관리자 이메일 고정값: `rapah0310@gmail.com`

2. 데이터 원본 정책
- 학생/선생님/회차 읽기·저장은 서버(Supabase) 단일 원본 기준
- 핵심 저장 경로는 `serverRequired: true` 원칙 적용

3. 회차 동기화 정책
- 회차/Meet 생성 소유자는 담당 선생님 이메일 기준
- 관리자 계정이 비소유자면 직접 생성 대신 `pending` 요청 저장
- `a/tmain`, `t/tmain`에서 `본인 학생 회차 동기화` 일괄 요청 가능

## 최근 변경(운영 영향 큰 항목)

- 2026-05-08 04:04: 관리자 `tmain` 경로를 `/a/tmain/[teacherToken]/smain/[studentToken]` 구조로 전환, 구 `/a/tmain/teacher/...`는 리다이렉트 유지, 멀티탭/휠클릭 QA 통과
- 2026-05-07 17:26: 프로덕션 배포 `dpl_5AuCDsWmHoEVbeBBSCW8GALK2cF3` (최신)
- 2026-05-06 17:49: `tmain` 회차 카드 공통화, 시간 표기 `HH:mm` 통일
- 2026-05-06 00:25: 기본회차 `분리보정` 기능 추가
- 2026-05-05 20:50: 회차 추가 운영 전환, `planCount/sessions` 정합성 자동 복구
- 2026-05-05 19:44: 학생 단일 백업/로컬 복원 도입(복원은 `NEXT_PUBLIC_TUTORWEB_LOCAL_ONLY=1`에서만)
- 2026-04-25 16:33: Drive `401` 재인증 경로를 `/auth/reauth?next=...`로 분리

## 품질/배포 체크 표준

배포 전 기본 순서:
1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

## 문서 운영 규칙

- 이 문서는 "현재 판단용 요약"만 유지합니다.
- 과거 상세 로그는 `docs/project-status-archive.md`에 누적합니다.
- 큰 패치/배포 후 즉시 아래를 갱신합니다.
  - `기준 시각`
  - `최신 운영 반영본(시각/주소/배포 ID)`
  - `최근 변경` 핵심 1~3줄
