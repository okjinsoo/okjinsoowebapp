# Project Status (Latest)

기준 시각: 2026-04-22 21:02 (KST)
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
- 2026-03-24 20:02 (KST) 프로덕션 배포 완료: `dpl_HF18LnEMHKoPvgpfipXpeCgmU2vM`
- 2026-03-31 11:10 (KST) 프로덕션 배포 완료: `dpl_GMYNdeA66w7eZ55hAkYWD4rp9g7k`
- 2026-04-19 12:38 (KST) 프로덕션 배포 완료: `dpl_2SG6oYE3GoiUUre6ReidxctbXPVn`
- 2026-04-21 19:38 (KST) 프로덕션 배포 완료: `dpl_4VYN4bNATfWtinMxxuGgYbCV1ZV1`
- 2026-04-21 20:42 (KST) 프로덕션 배포 완료: `dpl_9zgJwJpzaHex2KnurjNETCUSYQLz`
- 2026-04-21 20:46 (KST) 프로덕션 배포 완료: `dpl_ETHPSvFavkySD4ErHAfptV1SZiKL`
- 2026-04-22 21:02 (KST) 프로덕션 배포 완료: `dpl_2WMDamHCB5W6c8aQ8v9kkqBgZNwf`
- 2026-04-22 21:02 (KST) 기준, 위 프로덕션 배포가 최신 운영 반영본입니다.

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

9. Google Calendar 401 자동 복구/루프 방지 추가 (2026-03-24)
- `lib/integrations/googleCalendarSync.ts`에 401 자동 복구 로직이 추가되어, 권한 만료 시 자동으로 재연결 OAuth 흐름으로 이동합니다.
- 자동 복구 시 현재 페이지를 `next`로 보존해, 인증 후 원래 화면으로 복귀합니다.
- 동일 401 오류는 짧은 시간 동안 dedupe 처리하여 콘솔 에러/전역 이벤트 도배를 완화했습니다.
- `lib/storage/sessions.ts`의 캘린더 동기화 상태 패치 저장 경로에 `suppressCalendarSync: true`를 적용해 재동기화 루프를 차단했습니다.
- `lib/ui/common/SharedSnapshotAgent.tsx`의 AUTH 이벤트 처리에서 로그인/로그아웃 키 리셋 동작을 보강해 중복 트리거를 줄였습니다.

10. 회차 동기화 소유권/운영 UX 보강 (2026-03-24)
- `StudentHubCore`의 `회차 동기화` 버튼 동작을 역할별로 정리했습니다.
- 관리자 계정이 담당 선생님 이메일과 다를 때는 직접 생성 대신 `pending` 요청만 저장합니다.
- 비소유자 계정에서 회차 일정이 변경되면 `synced`를 유지하지 않고 `pending`으로 강등해 실제 반영 누락을 방지합니다.
- 생성/수정 결과에서 `eventId`가 없으면 성공 처리하지 않도록 보강했습니다.
- `a/tmain`, `t/tmain` 학생 리스트 상단에 `본인 학생 회차 동기화` 버튼을 추가했습니다.
- 상단/홈 로그아웃 버튼은 브리지 쿠키 삭제 요청 후 강제 홈 이동하도록 보강했습니다.
- 위 변경사항은 2026-03-24 20:02 (KST) 프로덕션 배포(`dpl_HF18LnEMHKoPvgpfipXpeCgmU2vM`)에 반영되었습니다.

11. 로그인 유지/권한 재연결 UX 개선 (2026-03-26, 코드 반영)
- 홈 로그인에 `로그인 유지하기` 옵션을 추가했습니다. 기본값은 ON이며, OFF 시 브라우저 종료 후 자동 로그아웃됩니다.
- 인증 세션 저장 위치를 `localStorage(유지)`/`sessionStorage(비유지)`로 분기할 수 있게 정비했습니다.
- 홈 로그인의 Google OAuth URL에서 `prompt=select_account consent` 강제값을 제거해, 매 로그인마다 권한 동의창이 뜨는 빈도를 줄였습니다.
- `/a|/t|/s` 접근 실패로 `/?next=...`로 돌아온 경우, 이미 로그인된 상태면 가능한 경로로 자동 복귀하도록 보강했습니다.
- 기존 `로그아웃 후 다시 로그인` 안내 문구를 `구글 권한 다시 연결` 중심으로 통일했습니다.
- 위 변경사항은 2026-03-31 11:10 (KST) 프로덕션 배포(`dpl_GMYNdeA66w7eZ55hAkYWD4rp9g7k`)에 반영되었습니다.

12. Google Drive 권한 종료 자동 복구 안전화 (2026-04-19, 배포 반영)
- `lib/integrations/googleDriveSync.ts`에서 Drive API `401`을 전용 에러 포맷으로 통일하고, 동일 오류 dedupe/자동 로그아웃 쿨다운을 추가했습니다.
- 권한 종료 시 자동 로그아웃 후 `/?next=현재경로`로 이동해, 재로그인 후 원래 화면으로 복귀하는 흐름을 유지합니다.
- `lib/ui/common/DriveUploadModal.tsx`에서 토큰 소실(오래된 로그인) 경로도 권한 종료 에러로 처리해 자동 복구가 누락되지 않도록 보강했습니다.
- Drive API의 `401` 외 HTTP 실패도 명확히 throw하도록 정리해, 업로드/삭제/폴더 생성 실패 원인 노출을 개선했습니다.
- 위 변경사항은 2026-04-19 12:38 (KST) 프로덕션 배포(`dpl_2SG6oYE3GoiUUre6ReidxctbXPVn`)에 반영되었습니다.

13. tmain/amain 긴급 UX 버그 수정 및 진입 지연 완화 (2026-04-21, 배포 반영)
- `tmain`의 `오늘의 수업` 카드 링크에 학생 토큰을 URL 쿼리로 함께 전달하도록 변경해, 휠클릭(새 탭 열기) 시 이전 학생 정보가 섞이던 문제를 수정했습니다.
- 세션 상세 화면(`a/t/smain/session/[index]`)에서 URL의 `token` 값을 우선 사용하도록 보강해, 새 탭 진입에서도 학생-회차 매칭이 일관되게 유지됩니다.
- `amain`의 `연장 요청`/`연장필요` 표시는 미처리(`extensionResult` 미결정)인 학생만 남도록 필터를 정리해, 이미 연장/미연장 처리된 학생 잔류 문제를 해소했습니다.
- 홈에서 관리자/선생님 화면으로 이동할 때 체감 지연을 줄이기 위해 `/a/amain`, `/t/tmain` prefetch를 추가했고, 학생 레지스트리 계산 경로를 학생별 세션 인덱싱 방식으로 최적화했습니다.
- 위 변경사항은 2026-04-21 19:38 (KST) 프로덕션 배포(`dpl_4VYN4bNATfWtinMxxuGgYbCV1ZV1`)에 반영되었습니다.

14. 세션 상세 버튼 긴급 복구 (2026-04-21, 배포 반영)
- 세션 상세 상단에 `이전 학습`, `이후 학습` 이동 버튼을 복구해 회차 간 이동을 다시 사용할 수 있게 했습니다.
- 회차 학습 영역의 `+ 문제 추가` 버튼 명칭을 `+ 오답 노트 링크`로 복구해 기존 운영 용어와 맞췄습니다.
- 위 변경사항은 2026-04-21 20:42 (KST) 프로덕션 배포(`dpl_9zgJwJpzaHex2KnurjNETCUSYQLz`)에 반영되었습니다.

15. `+ 문제 추가` 라벨 롤백 (2026-04-21, 배포 반영)
- 운영 요청에 따라 회차 학습 영역 버튼 라벨을 `+ 오답 노트 링크`에서 `+ 문제 추가`로 즉시 롤백했습니다.
- 위 변경사항은 2026-04-21 20:46 (KST) 프로덕션 배포(`dpl_ETHPSvFavkySD4ErHAfptV1SZiKL`)에 반영되었습니다.

16. Drive 401 자동 재로그인 잠금 UX 및 amain 연장요청 필터 단순화 (2026-04-22, 배포 반영)
- Drive 401 자동 복구 시 홈으로 이동할 때 `reauth=1` 플래그를 함께 전달하도록 보강했습니다.
- 홈(`app/page.tsx`)에서 `reauth=1` 감지 시 전체 잠금 오버레이(클릭 차단)와 `잠시만 기다려 주세요` 안내를 표시하고, 자동으로 Google 재로그인을 시작하도록 정리했습니다.
- 재로그인 잠금 중에는 기존 `next` 자동 복귀/학생 자동 이동 흐름이 동시에 실행되지 않도록 가드해 이동 충돌을 줄였습니다.
- `amain`의 `연장 요청` 카드는 상담 결과 필드가 아닌 학생 상태(`status === need_extension`)만으로 필터하도록 단순화했습니다.
- 위 변경사항은 2026-04-22 21:02 (KST) 프로덕션 배포(`dpl_2WMDamHCB5W6c8aQ8v9kkqBgZNwf`)에 반영되었습니다.

## 배포 전 체크 표준

아래 순서를 기본으로 실행합니다.

1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

## 업데이트 규칙

- 다음 스레드에서 큰 패치/배포가 끝나면 이 파일의 "기준 시각"과 "현재 확정 상태"를 최신으로 갱신합니다.
- 운영 정책(관리자 이메일, 인증 방식, 배포 주소)이 바뀌면 같은 날 바로 반영합니다.
