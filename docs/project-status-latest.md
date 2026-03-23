# Project Status (Latest)

기준 시각: 2026-03-23 22:25 (KST)
대상 프로젝트: `v1`

## 현재 확정 상태

1. 인증/보안
- API/페이지 보호 로직이 통합 정비되었습니다.
- 브리지 쿠키 기반 검증 및 보안 로그 관련 변경이 반영되었습니다.

2. 라우팅 가드 파일 규약
- `middleware.ts`는 `proxy.ts`로 전환 완료되었습니다.
- Next.js 16 기준 deprecated 경고(미들웨어 파일명 관련)는 해소되었습니다.

3. CI/품질 게이트
- CI에 lint 단계가 포함되었습니다.
- 로컬 기준 `lint`, `test:run`, `build`가 통과하는 상태로 정리되었습니다.

4. 운영 배포
- Vercel 프로덕션 배포 완료 상태입니다.
- 운영 주소: `https://okjinsoowebapp.vercel.app`
- 2026-03-23 15:34 (KST) 프로덕션 재배포 완료: `dpl_FZatVHcJjYb629hszj7PMX75LzBF`
- 2026-03-23 22:25 (KST) 기준, 위 프로덕션 배포가 최신 반영본입니다.

5. 관리자 계정 정책(현재 고정)
- 관리자 이메일은 현재 고정값입니다: `rapah0310@gmail.com`
- 추후 다중 관리자 정책은 별도 요청 시 확장합니다.

6. 데이터 원본 정책(서버 단일 원본 전환)
- 학생/선생님/회차의 주요 읽기/저장 흐름은 서버 기준으로 정비되었습니다.
- `lib/storage` 바깥의 `loadStudents/loadTeachers/loadSessions` 직접 호출은 정리 완료되었습니다.
- `saveStudents/saveTeachers/saveSessions`에 `serverRequired` 옵션이 도입되었고, 핵심 내부 경로에는 `serverRequired: true`가 적용되었습니다.
- `saveStudentsServerFirst/saveTeachersServerFirst/saveSessionsServerFirst`는 서버 기준 데이터 기반으로 동작하도록 정리되었습니다.

7. 사용자 안내/회귀 테스트 정비
- 서버 저장/로딩 실패 문구를 공통 메시지로 통일했습니다.
- 서버 기준 데이터 부재 시 로컬 데이터가 덮어써지지 않는 회귀 테스트(`lib/storage/serverRequiredSave.test.ts`)가 추가되었습니다.

8. Google Calendar 401 복구 UX 개선 (2026-03-23)
- `구글 권한 다시 연결` 버튼이 `/auth/callback` 경유로 복귀하도록 보강되었습니다.
- OAuth 콜백이 `next` 파라미터를 읽어 로그인 후 원래 화면으로 복귀합니다.
- 홈 로그인 시 `/a`, `/t` 진입 맥락(또는 최근 역할이 a/t)이면 캘린더 scope를 포함해 재인증합니다.
- 회차 동기화 재시도 시 401 반복이 줄어드는 흐름으로 정리되었습니다.

## 배포 전 체크 표준

아래 순서를 기본으로 실행합니다.

1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

## 업데이트 규칙

- 다음 스레드에서 큰 패치/배포가 끝나면 이 파일의 "기준 시각"과 "현재 확정 상태"를 최신으로 갱신합니다.
- 운영 정책(관리자 이메일, 인증 방식, 배포 주소)이 바뀌면 같은 날 바로 반영합니다.
