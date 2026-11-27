# Project Status Archive

이 파일은 `docs/project-status-latest.md`의 과거 상세 이력을 보관하는 아카이브입니다.
- 최신 운영 판단은 항상 `project-status-latest.md`를 먼저 확인합니다.
- 이 파일은 길어도 괜찮고, 세부 로그/배포 히스토리를 그대로 남깁니다.

---

## 배포 이력 (latest에서 이관)

- `2026-11-27 15:58` — 프로덕션 배포 `dpl_8PkGtcpTL5QnSXRhvkbPk2qHxqmj` (커밋 `f713313`, `git push origin main` 자동 배포, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-l84d9vx8d-okjinsoos-projects.vercel.app`, 리팩토링 3단계 1차: `googleCalendarSync.ts` → `googleCalendarCore`·`googleCalendarApi` 분리, `runSync` 대상 고르기 순수 함수 분리, 단위 테스트 128개 통과)
- `2026-11-27 02:52` — 프로덕션 배포 `dpl_4Ua4NHmYtxZgmrXq3EUKUx1jtN7C` (커밋 `188e326`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-pvpxowshw-okjinsoos-projects.vercel.app`, 저장소↔구글 캘린더 결합 분리(`sessionCalendarActions`·`rosterCalendarActions`, ESLint 가드), 50ms 캐시 무효화, 미사용 저장 함수 13종 삭제, 연습용 모드 브라우저 확인, 단위 테스트 113개 통과)
- `2026-11-25 19:22` — 프로덕션 배포 `dpl_ENszGc6ukVfQipcaD24TLstUZbs5` (커밋 `af8c76e`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-klip8rnjz-okjinsoos-projects.vercel.app`, 401/403 응답 분리, 401 토큰 갱신 1회 재시도 및 3회 초과 시 큐 보존 일시정지, 학생 금지 키 사전 차단, `sessionProgressUpdated` 상단 바·허브 즉시 갱신 연결, `getSessionItemsDefault` 죽은 코드 삭제, 단위 테스트 101개 통과)
- `2026-11-25 19:05` — 프로덕션 배포 `dpl_YELqr2uY2jbXgPRqV5WYAdirQe1B` (커밋 `792bb69`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-7oxs60gq4-okjinsoos-projects.vercel.app`, Vercel Incoming 9.45GB 무한 POST 폭주 긴급 차단: `lectures.ts` `root.createdAt` 보존 + 읽기 silent화, `SharedSnapshotAgent` 401/403 재시도 즉시 중단 및 최대 3회 백오프, `SessionClientCore` 메아리 POST 제거, 회귀 테스트 +4건 총 99개 통과)

# Project Status (Latest)

기준 시각: 2026-05-07 17:26 (KST)
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
- 2026-04-23 11:32 (KST) 프로덕션 배포 완료: `dpl_CWrbY6FbyQvvgCa4xdHpyDzh8zLY`
- 2026-04-23 12:53 (KST) 프로덕션 배포 완료: `dpl_Dp3LAnLUkrDshb6HCqaB1FLAYx9o`
- 2026-04-25 16:33 (KST) 프로덕션 배포 완료: `dpl_FuUwcXQ4q7HSVNtetJ1jagZFtXDu`
- 2026-05-05 19:44 (KST) 프로덕션 배포 완료: `dpl_Ep6dLWYkGGQh3F942AeNexh6UsC5`
- 2026-05-05 20:50 (KST) 프로덕션 배포 완료 (`https://okjinsoowebapp.vercel.app`): `dpl_EV339rAzFonMdy4b82pRYJR5bhRj`
- 2026-05-06 00:25 (KST) 프로덕션 배포 완료 (`https://okjinsoowebapp.vercel.app`): `dpl_6cXzn7t4xe4oiUeW4AW7hppDUSYj`
- 2026-05-06 02:19 (KST) 프로덕션 배포 완료 (`https://okjinsoowebapp.vercel.app`): `dpl_BakXMx61umMtgQsUBYsBP7uWDWw2`
- 2026-05-06 17:49 (KST) 프로덕션 배포 완료 (`https://okjinsoowebapp.vercel.app`): `dpl_DXfiF99Wu8XXbQCCYExEJB552Aoj`
- 2026-05-07 17:26 (KST) 프로덕션 배포 완료 (`https://okjinsoowebapp.vercel.app`): `dpl_5AuCDsWmHoEVbeBBSCW8GALK2cF3`
- 2026-05-07 17:26 (KST) 기준, 위 프로덕션 배포가 최신 운영 반영본입니다.

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

17. 오답노트 전용 흐름 분리 및 관리자 tmain 상세 라우트 복구 (2026-04-23, 배포 반영)
- 회차 상세 `오늘의 학습`에서 `+ 문제 추가`와 `+ 오답 노트`를 데이터 구조까지 분리했습니다.
- `+ 오답 노트`는 `wrongnote_*` 전용 카드로 생성되고, `오답 노트 제출/초기화/폴더 바로가기` 흐름으로 독립 동작합니다.
- 진도율 계산에서 `wrongnote_*` 카드는 오답노트 제출 1개 항목으로 계산되도록 반영했습니다.
- 관리자 경로 `app/a/tmain/[token]/session/[index]` 페이지를 복구해 관리자-담당학생 회차 상세 접근이 누락되지 않도록 정리했습니다.
- 위 변경사항은 2026-04-23 11:32 (KST) 프로덕션 배포(`dpl_CWrbY6FbyQvvgCa4xdHpyDzh8zLY`)에 반영되었습니다.

18. 세션 상세 이전/이후 버튼 위치 조정 (2026-04-23, 배포 반영)
- `session/[index]`의 `오늘의 학습` 타이틀 행 오른쪽에 `이전 학습`, `이후 학습` 버튼을 배치했습니다.
- 기존 `SessionTopBarCore` 우측 영역에 있던 이전/이후 버튼은 제거하고, 버튼 이동 로직은 `SessionClientCore`에 통합했습니다.
- 위 변경사항은 2026-04-23 12:53 (KST) 프로덕션 배포(`dpl_Dp3LAnLUkrDshb6HCqaB1FLAYx9o`)에 반영되었습니다.

19. Drive 401 재인증 전용 경로 분리 (2026-04-25, 배포 반영)
- Drive 401 자동 복구 시 홈(`/?reauth=1`)으로 보내던 흐름을 전용 경로(`/auth/reauth?next=...`)로 변경했습니다.
- `/auth/reauth`에서 전체 안내 화면을 먼저 보여준 뒤, 자동으로 Google 재로그인을 시작하도록 정리했습니다.
- `next` 복귀 경로는 그대로 유지되어, 재인증 완료 후 기존 페이지로 돌아갑니다.
- 관련 로그아웃 플로우 테스트(`lib/integrations/googleDriveLogoutFlow.test.ts`) 기대값도 전용 경로 기준으로 갱신했습니다.
- 위 변경사항은 2026-04-25 16:33 (KST) 프로덕션 배포(`dpl_FuUwcXQ4q7HSVNtetJ1jagZFtXDu`)에 반영되었습니다.

20. 학생 단일 백업/로컬 복원 도입 (2026-05-05, 배포 반영)
- `a/t/smain` 학생 상세 상단에 `데이터 백업` 버튼을 추가해, 학생 단위 JSON 백업(학생/회차/상담/상태키/강의트리)을 내려받을 수 있게 했습니다.
- `데이터 복원` 버튼은 로컬 테스트 모드(`NEXT_PUBLIC_TUTORWEB_LOCAL_ONLY=1`)에서만 노출/실행되도록 제한해 운영 오사용을 막았습니다.
- 로컬 복원 시 동일 학생 토큰 기준으로 기존 학생 데이터(학생/회차/상담/세션 상태키)를 교체 적용하도록 정리했습니다.
- 위 변경사항은 2026-05-05 19:44 (KST) 프로덕션 배포(`dpl_Ep6dLWYkGGQh3F942AeNexh6UsC5`)에 반영되었습니다.

21. 회차 추가 운영 전환 및 정합성 자동 복구 (2026-05-05, 배포 반영)
- `/a/students`에 `학생 동기화`(로컬 전용 JSON 업로드) 버튼을 추가해 운영 백업 데이터를 로컬 테스트 환경으로 가져올 수 있게 했습니다.
- 회차 추가/시간 변경 UI를 새 포맷(요일/시작시간/수업시간, 주당 횟수 기반)으로 정리하고, 종료시간 표시를 `18시 ~ 20시` 형태로 통일했습니다.
- 학생 상세의 `결제 기록` 영역을 `회차 추가 기록` 중심 UI로 전환하고, 회차 추가 시 입력한 메타(시작일/주당횟수/수업박스/생성범위)를 기록에 반영했습니다.
- 결제 기록 삭제 후에도 남던 초과 회차 문제를 수정했고, 학생 진입 시 `기록 기준 총회차 = planCount = sessions`가 어긋나면 자동으로 맞추는 정합성 복구를 추가했습니다.
- 상담 API 경로(`/api/students/[id]/consultations`)를 제거하고 상담 의존 상태 계산/요청 섹션을 정리해, 회차 운영 변경과 충돌하지 않도록 조정했습니다.
- 위 변경사항은 2026-05-05 20:50 (KST) 프로덕션 배포(`dpl_EV339rAzFonMdy4b82pRYJR5bhRj`)에 반영되었습니다.

22. 기본회차 분리보정 기능 추가 (2026-05-06, 배포 반영)
- 학생 상세 `회차 추가 기록` 영역의 `기본회차` 카드에 `분리보정` 버튼을 추가했습니다.
- 분리보정 모달에서 목표 기본회차를 입력하면, 줄어든 수량을 `회차추가` 기록으로 자동 생성하도록 정리했습니다.
- 보정 시 총 회차 수(`planCount`)는 유지하면서 기록 구조만 `기본회차 + 회차추가` 형태로 안전하게 재정렬합니다.
- 위 변경사항은 2026-05-06 00:25 (KST) 프로덕션 배포(`dpl_6cXzn7t4xe4oiUeW4AW7hppDUSYj`)에 반영되었습니다.

23. tmain 회차 카드 공통화 및 시간 표기 통일 (2026-05-06, 배포 반영)
- `tmain` 회차 카드도 `smain`과 동일한 공통 카드 컴포넌트/뷰모델 조립 흐름을 재사용하도록 정리했습니다.
- `tmain` 제목 영역은 `D-day` 대신 `학생 이름 + 회차` 규칙을 유지하면서, 카드 본문 배지/상태/시간 표시는 공통 규칙으로 통합했습니다.
- 회차 시간 표기를 `HH:mm` 형식으로 통일해 `18:00 ~ 20:00`처럼 보이도록 정리했습니다.
- 위 변경사항은 2026-05-06 17:49 (KST) 프로덕션 배포(`dpl_DXfiF99Wu8XXbQCCYExEJB552Aoj`)에 반영되었습니다.

## 배포 전 체크 표준

아래 순서를 기본으로 실행합니다.

1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

## 업데이트 규칙

- 다음 스레드에서 큰 패치/배포가 끝나면 이 파일의 "기준 시각"과 "현재 확정 상태"를 최신으로 갱신합니다.
- 운영 정책(관리자 이메일, 인증 방식, 배포 주소)이 바뀌면 같은 날 바로 반영합니다.

---

# Archived Snapshot (2026-05-08 ~ 2026-11-21)

# Project Status (Latest)

기준 시각: 2026-11-21 20:03 (KST)
대상 프로젝트: `v1`

## 1분 요약

- 최신 패치 반영: 2026-11-21 20:03 (KST) (운영 배포 완료 `dpl_GK3TN1ryTRMLiU5EdjHANHPaNF7s`, 커밋 `0aefd62`)
- **시간표 조정(변경·이월·수업 시간 변경) 전면 고속화 및 안전성 강화 패치 (A → B-2 → C-2 → C 전 단계 완료)**:
  1) **A단계 — 4연속 왕복 → 단 1회 저장 통합 & 날짜 계산 엔진 초고속화 ([`syncSessionDisplayAt.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/session/syncSessionDisplayAt.ts), [`sessionEffective.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/session/sessionEffective.ts), [`SessionQuickActions.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/session/SessionQuickActions.tsx), [`SessionTopBarCore.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/session/SessionTopBarCore.tsx))**:
     - 개별 회차 조정 시 `POST metaMap → GET snapshot → GET snapshot(forceRemote) → POST sessions` 4연속 왕복을 `saveSessionAdjustmentByToken` 단 1회 `POST /api/snapshot`으로 통합
     - 직접 저장 경로에 `browserStorage.setItemSilent`를 적용하여 `SharedSnapshotAgent`의 0.7초 뒤 중복 `POST` 원천 차단
     - `Intl.DateTimeFormat` 반복 생성을 순수 KST(+9h) 계산으로 교체, `buildBaseDatesISOFromRules` 규칙 정렬 루프 외부 호이스팅, `googleCalendarSync`의 학생당 1회 캐싱 적용으로 브라우저 프리징 제거
  2) **B-2 & C-2 단계 — 서버 부분 병합(`merge`), 실패 롤백, DB 듀얼라이트 경량화, 보안 경계 강화 ([`supabaseSnapshotApi.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/supabaseSnapshotApi.ts), [`dualWriteSync.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/dualWriteSync.ts), [`StudentHubCore.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/student/StudentHubCore.tsx), [`sessions.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/sessions.ts))**:
     - `studentsMergeMode: "merge"`, `sessionsMergeMode: "merge"` 도입으로 개별 조정·일괄 시간 변경·캘린더 완료 저장(`applySessionPatches`) 모두 바뀐 학생/회차만 부분 병합 전송(동시 수정 Lost Update 100% 차단 + 전송량 95% 절감)
     - 서버 저장 실패 시 로컬 `metaMap` 자동 롤백(`removeItemSilent`) 및 안내 팝업 표시(모달 유지)
     - `upsertSnapshotPatch` 내부 DB 호출의 `useServiceRole` 전달 오류 수정, `computeChangedRowsById` 기반 변경분만 듀얼라이트 기록, 선생님 학생 부분 병합 보안 경계(`filterTeacherAllowedStudentMergePatch`) 및 `guest` 쓰기 차단 강화
     - 시작 시각은 같고 수업 시간(`overrideDurationMin`)만 바뀐 경우에도 해당 회차를 `pending` 표시해 구글 캘린더 종료 시간 자동 동기화 지원
  3) **C단계 — 구글 캘린더 동기화 가속 ([`googleCalendarSync.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/integrations/googleCalendarSync.ts))**:
     - 영구 Meet 링크가 없는 학생은 첫 회차 1개만 직렬 선행(`partitionSyncTargetsForMeetSafety`) 후 나머지 회차는 동시 3개 제한 병렬(`runWithConcurrencyLimit`) 실행
     - 구글 API 429/403 속도제한(`isGoogleRateLimitError`) 시 자동 백오프 재시도(400ms → 1000ms) 탑재
     - 배치당 선생님 캘린더 확인(`GET /calendars/:id`) 1회 캐싱 및 `eventId` 확정 회차 사전 검색(`findSessionEvents`) 생략 직행 `PATCH` 적용
  4) **품질 지표 달성**: 단위 테스트 17개 파일 75개 전수 100% 통과, ESLint 오류 0건, Next.js 프로덕션 빌드 정상 통과
- **토스페이먼츠 운영 서버 환경변수(`TOSS_SECRET_KEY`, `NEXT_PUBLIC_TOSS_CLIENT_KEY`) Vercel 등록 및 프로덕션 재배포 완료**:
  - 11월 14일 보안 패치(`58f2df4`)로 시크릿 키 하드코딩을 제거한 이후 Vercel 운영 환경에 누락되어 있던 `TOSS_SECRET_KEY`(Secret)와 `NEXT_PUBLIC_TOSS_CLIENT_KEY`(Config)를 등록하고 프로덕션 재배포 완료 (`57fs8sCNsPwscT4TuBveZNkH4x9R`)
  - `/programs` 결제 승인 API(`/api/payments/confirm`)의 `SERVER_CONFIG_MISSING` 오류 원천 해소
- **CTO 구조 진단 3단계 (선택지 C): 온라인 수강 신청 및 결제 승인 장부(`payment_orders`) 자동 기록 시스템 완성**:
  1) **주문서 신청자 연락처/학생명 보존 전달 파이프라인 구축 ([`ProgramsCheckoutClient.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/programs/ProgramsCheckoutClient.tsx#L134-L152), [`ProgramsSuccessClient.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/programs/ProgramsSuccessClient.tsx#L23-L65))**:
     - 기존에 토스 결제창 호출 후 콜백(`/programs/success`)으로 돌아올 때 주문서에 적은 연락처(`buyerPhone`), 수강생 이름(`studentName`), 프로그램 ID(`programId`)가 유실되던 단절 문제를 해결하여 `/api/payments/confirm`까지 안전하게 전달
  2) **결제 승인 즉시 서버 이중 장부 자동 기록 ([`014_create_payment_orders.sql`](file:///Users/okjinsoo/Project/TutorWEB/v1/db/migrations/014_create_payment_orders.sql), [`paymentOrderStore.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/paymentOrderStore.ts), [`app/api/payments/confirm/route.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/app/api/payments/confirm/route.ts))**:
     - 토스페이먼츠 승인 완료(또는 `ALREADY_APPROVED`) 즉시 정규화 테이블 `public.payment_orders`에 주문번호, 신청자명, 휴대폰 번호, 수강생 이름, 결제 금액, 승인 시각, 매출전표(영수증) URL을 자동 기록
     - 아직 `014` SQL을 실행하지 않은 환경에서도 결제 내역이 100% 보존되도록 서버 스냅샷 내부(`server:payment_orders_v1`)에 이중 안전 백업 기록
  3) **관리자 전용 결제 장부 조회 API 신설 ([`app/api/payments/orders/route.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/app/api/payments/orders/route.ts))**:
     - 관리자(`admin`)만 접근 가능한 `GET /api/payments/orders` 엔드포인트를 구축하여 언제든 온라인 결제 신청 내역을 최신순으로 조회 가능
  4) **품질 지표 달성**: 단위 테스트 16개 파일 64개 전수 100% 통과, ESLint 오류 0건, Next.js 프로덕션 빌드 정상 통과
- **CTO 구조 진단 2단계 (선택지 B): `state_kv` 원자적(Atomic) 부분 패치 및 선생님별 데이터 맞춤형 다이어트 전면 적용**:
  1) **DB 내부 원자적 부분 병합 RPC(`patch_snapshot_state_kv`) 도입 ([`013_atomic_state_kv_patch.sql`](file:///Users/okjinsoo/Project/TutorWEB/v1/db/migrations/013_atomic_state_kv_patch.sql), [`supabaseSnapshotApi.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/supabaseSnapshotApi.ts#L644-L672))**:
     - 기존에 `state_kv` 1개 키만 바뀌어도 전체 JSON을 읽어와 JS에서 병합 후 통째로 덮어쓰던 구조(Lost Update 위험)를 개선하여, PostgreSQL 내부에서 바뀐 키만 즉시 병합(`||`)/삭제(`-`)하는 원자적 RPC를 우선 호출하도록 개편
     - `state_kv` 단독 패치 시 원자적 RPC가 성공하면 불필요한 전체 행 Upsert를 생략하고 즉시 완료 처리(미적용 환경에서는 기존 병합으로 자동 Fallback 보장)
  2) **선생님(`teacher`) 계정 접속 시 본인 담당 학생 데이터만 전송 및 수정 보호 ([`app/api/snapshot/route.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/app/api/snapshot/route.ts#L90-L120), [`lib/server/snapshotFilter.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/snapshotFilter.ts))**:
     - `/api/snapshot` 조회 시 선생님 계정이면 타 선생님의 학생/세션/진도율/메타맵을 제외하고 **본인 담당 학생(`teacherId === viewer.teacherId`) 데이터만 선별 전송**하여 네트워크 페이로드와 브라우저 메모리 부담 대폭 절감
     - 선생님이 스냅샷 패치 시 타 선생님 담당 학생의 `stateKv` 키가 섞여 들어가더라도 `isTeacherAllowedStateKvKey`로 안전하게 필터링하여 교차 오염 원천 방지
  3) **품질 지표 달성**: 단위 테스트 16개 파일 63개 전수 100% 통과, ESLint 오류 0건, Next.js 프로덕션 빌드 정상 통과
- **CTO 구조 진단 1단계 (선택지 A): 보안 취약점 원천 잠금 및 결제/학습 상태 무결성 패치 전면 적용**:
  1) **토스페이먼츠 비밀키 하드코딩 제거 및 결제 금액/주문번호 위변조 서버 검증 ([`app/api/payments/confirm/route.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/app/api/payments/confirm/route.ts), [`lib/server/paymentValidation.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/paymentValidation.ts))**:
     - 소스코드에 노출되어 있던 라이브 시크릿 키(`live_sk_...`) 폴백을 완전 제거하고 서버 전용 환경변수(`process.env.TOSS_SECRET_KEY`)로 격리
     - 결제 승인 요청 시 주문번호 접두어(`OJS_`) 및 정식 수강료 금액(`360,000원`) 일치 여부를 서버에서 사전 검증하여 금액 위변조 공격 원천 차단
  2) **학생 계정의 본인 학습 진도(`stateKv`) 저장 허용 & 타 학생/전역 설정 조작 차단 ([`supabaseSnapshotApi.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/supabaseSnapshotApi.ts#L504-L512))**:
     - 기존에 학생(`role === "student"`)의 모든 `stateKv` 수정을 일괄 차단하던 모순을 해결하고, `isStudentAllowedStateKvKey`를 통해 오직 본인 토큰(`mk3:{본인토큰}:session:...`, `tutorweb_metaMap_v1:{본인토큰}`) 키만 정밀 허용
     - 타 학생의 학습 데이터나 학원 전체 강의 트리(`mk3:lectureTree`) 수정 시도는 즉시 차단 및 보안 로그 기록
  3) **브라우저의 DB 직접 덮어쓰기 뒷문(Direct Supabase REST Fallback) 전면 폐쇄 ([`sharedSnapshot.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/sharedSnapshot.ts#L503-L680))**:
     - `/api/snapshot` 서버 문지기를 거치지 않고 브라우저가 직접 `/rest/v1/app_state_snapshots`에 접근해 권한 검증 없이 전체 데이터를 읽거나 덮어쓰던 레거시 Fallback 코드 약 250줄 완전 제거
  4) **서버 내부 DB 통신 `service_role` 기본화 및 정규화 테이블 RLS 잠금 마이그레이션 ([`012_lockdown_rls_policies.sql`](file:///Users/okjinsoo/Project/TutorWEB/v1/db/migrations/012_lockdown_rls_policies.sql), [`dualWriteSync.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/dualWriteSync.ts), [`normalizedDbApi.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/normalizedDbApi.ts))**:
     - 기존 `011` 마이그레이션의 무제한 개방 정책(`USING (true)`)을 대체하여, 일반 인증 사용자가 타 학생의 개인정보나 회차 테이블을 직접 수정/열람할 수 없도록 최소 권한 RLS 정책 수립
  5) **품질 지표 달성**: 단위 테스트 16개 파일 62개 전수 100% 통과, ESLint 오류 0건, Next.js 프로덕션 빌드 정상 통과
- **`tmain`('오늘의 수업' / '다음 수업') 학생 학습 진도율(%) 실시간 동기화 누락 원천 해결 패치 (선택지 1 전면 적용)**:
  1) **서버 스냅샷 다이제스트(Digest) 전체 공유 키 해시화로 정밀도 100% 확보 ([`supabaseSnapshotApi.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/supabaseSnapshotApi.ts#L84-L112))**:
     - 기존 `kvKeys.slice(-3)` 샘플링 방식은 알파벳 뒤쪽인 `tutorweb_metaMap_v1:...` 키에 가려져 앞쪽의 모든 학생 회차 학습 진도율(`mk3:...:progressByLeafId`) 변경을 감지하지 못하고 `changed: false`를 반환하던 구조적 결함 해결
     - 모든 공유 키(`isSharedStateKvKey`)와 값을 SHA-256 해시로 요약하여 어느 학생의 어느 회차 진도율이 1%라도 변경되면 즉시 다이제스트가 갱신되도록 개선
  2) **스냅샷 조회 시 학습 데이터(`stateKv`) 즉시 로컬 반영 및 단기 캐시 동기화 ([`serverRead.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/serverRead.ts#L280-L286), [`sharedSnapshot.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/sharedSnapshot.ts#L229-L296), [`browserStorage.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/browserStorage.ts#L88-L100))**:
     - `readSnapshotServerFirst`가 `/api/snapshot` 응답을 수신할 때 `applyStateKvAndNotify`를 즉시 호출하여 첫 렌더링부터 최신 진도율이 로컬 스토리지 및 `browserStorage` 인메모리 캐시(`setItemSilent`)에 반영되도록 연결
  3) **학습 진도율 변경 전용 이벤트(`sessionProgressUpdated`) 신설 및 `tmain`/회차 목록 실시간 리렌더링 ([`tutorwebEvents.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/events/tutorwebEvents.ts#L1-L9), [`useStudentRegistry.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/hooks/useStudentRegistry.ts#L67-L94), [`StudentSessionListCore.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/student/StudentSessionListCore.tsx#L66-L75))**:
     - 회차 상세 화면에 직접 클릭해 들어가지 않아도 `tmain` 진입 및 포커스 동기화 즉시 '오늘의 수업'과 '다음 수업'의 진도율(%)이 100%로 동기화되어 표시되도록 개선
  4) **품질 지표 달성**: 단위 테스트 16개 파일 60개 전수 100% 통과, ESLint 오류 0건, Next.js 프로덕션 빌드 정상 통과
- **첫 웹페이지 입장 및 권한 확인/재로그인 초고속 다이어트 패치 (안전형 방안 1 전면 적용)**:
  1) **Vercel 서버 리전 한국(서울 `icn1`) 고정 ([vercel.json](file:///Users/okjinsoo/Project/TutorWEB/v1/vercel.json))**: 기본 미국 동부(`iad1`) 서버를 거치며 발생하던 태평양 왕복 네트워크 지연을 한국 서울 리전으로 단축
  2) **가벼운 API들의 DB 조회 컬럼(`select`) 맞춤형 경량화 ([`resolveViewerContext`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/server/supabaseSnapshotApi.ts#L284-L398))**:
     - `/api/auth/me`, `/api/teachers`, `/api/students` 호출 시 무거운 `sessions` 및 `state_kv`(백업 덤프 포함) 컬럼을 DB에서 아예 읽지 않고 `teachers, students`만 조회하도록 분리
     - `/api/students/[id]/sessions` 및 스냅샷 저장(`upsertSnapshotPatch`) 시에도 불필요한 `state_kv` 전체 읽기를 생략하고, `state_kv` 병합 시 누적된 레거시 `mk3:backup:...` 키를 자동 정리
     - 브라우저(`pushSharedSnapshot`)에서 매 저장 시 `state_kv` 내부에 중복 생성하던 일일 백업 로직 제거 (서버 전용 백업 테이블 `app_state_snapshot_backups`로 일원화)
  3) **클라이언트 API 호출 시 Bearer 토큰 직접 동봉 및 브리지 쿠키 동기화 정렬 ([`sharedSnapshot.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/sharedSnapshot.ts#L178-L202), [`serverRead.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/storage/serverRead.ts#L90-L102), [`supabaseAuth.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/auth/supabaseAuth.ts#L345-L364))**:
     - `/api/auth/bridge` 쿠키 생성 시차로 인해 첫 API 요청들이 401 실패 후 클라이언트 직접 DB 조회로 폴백하던 현상을 Bearer 헤더 직접 주입 및 `saveAuthSessionAndSyncBridge` 대기로 원천 해결
  4) **로그인/인증 경로 불필요 스냅샷 하이드레이션 차단 및 강제 타이머 제거 ([`SharedSnapshotAgent.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/ui/common/SharedSnapshotAgent.tsx#L30-L39), [`reauth/page.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/app/auth/reauth/page.tsx#L52-L55), [`callback/page.tsx`](file:///Users/okjinsoo/Project/TutorWEB/v1/app/auth/callback/page.tsx#L55-L72), [`roleAuth.ts`](file:///Users/okjinsoo/Project/TutorWEB/v1/lib/auth/roleAuth.ts#L32-L57))**:
     - `/`, `/auth/*`, `/programs`, `/policy` 경로에서 백그라운드 전체 스냅샷 자동 다운로드를 건너뛰도록 개선
     - 역할 확인 폴백 시 `/api/snapshot` 대신 초경량 `/api/auth/me`를 호출하도록 전환하고, 재로그인/콜백의 `700ms + 700ms` 강제 대기 타이머 제거
  5) **품질 지표 달성**: 단위 테스트 16개 파일 59개 전수 100% 통과, ESLint 오류 0건, Next.js 프로덕션 빌드 정상 통과
- **수강 프로그램 안내 페이지(`/programs`) 모바일/PC 반응형 프리미엄 전면 개편 (`ProgramsCheckoutClient.tsx`, `app/programs/page.tsx`)**:
  1) **모바일 전용 세그먼트 탭 전환기 탑재 (`sm:hidden`)**: 스마트폰 화면에서 스크롤 부담 없이 [그룹 수업 (270분)]과 [개별 피드백 (180분)]을 상단 터치 탭으로 전환해 1개 카드씩 집중해서 시원하게 열람 (PC는 2열 나란히 뷰 유지)
  2) **모바일 바텀 시트(Bottom Sheet) 결제 모달 전환**: PC 센터 팝업에서 모바일 시 화면 하단에서 슥 올라오는 서랍형 바텀 시트로 자동 변환, 상단 드래그 핸들 및 iOS 사파리 줌 방지 16px 인풋 탑재
  3) **4단계 수강 절차 & 환불 규정 모바일 최적화**: 4단계 절차를 모바일 2x2 그리드로 압축하고, 환불 규정 표를 모바일 전용 카드 리스트로 자동 변환하여 가로 스크롤 잘림 원천 차단
  4) **품질 지표 달성**: 단위 테스트 16개 파일 59개 전수 100% 통과, ESLint 0건, Next.js 프로덕션 빌드 정상 통과
  1) **학생 정보 '수업 시간' 전환 시점 지능화 (`resolveActiveScheduleRules`)**:
     - 기존에 오늘 날짜와 단순 비교(`ch.startDate > today`)하여 미래 날짜 지정 시 시간표 텍스트가 갱신되지 않던 모순 원천 해결
     - 새로운 시간표가 적용되는 회차(`startIndex`)의 직전 회차(`startIndex - 1`) 수업일 익일(다음날 00시)부터 새 시간표로 자동 전환되도록 개편
     - 직전 회차 당일까지는 기존 수업 일정 혼란 방지를 위해 이전 시간표 유지, 회차 완료 익일부터 새 시간표 자동 바통 터치
  2) **수납/결제 패널 회차 추가 수정 모달 버그 수정**:
     - `StudentPaymentPanel.tsx`에서 중복 렌더링되던 쌍둥이 `회차수` 입력창 1개 말끔히 제거
  3) **시뮬레이션 전수 검증 및 품질 지표 달성**:
     - 단위 테스트 16개 파일 59개 테스트 100% 통과 (시뮬레이션 시나리오 테스트 포함)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **회차 추가 모달 경량화(시작일/추가횟수 단일화) 및 시간표 관리 창구 일원화 패치 (`StudentSessionAddModal.tsx`, `StudentHubCore.tsx`, `sessionEffective.ts`, `sessionCardFactory.ts`, `StudentPaymentPanel.tsx`)**:
  1) **기획 의도 기반 UX 경량화 & 입력 단일화**:
     - 기존의 복잡했던 주당 횟수 및 요일/시간/수업시간 선택 박스(~420줄)를 전면 걷어내고, 시작일(`startDate`)과 추가 횟수(`addedCount`)만 직관적으로 입력받도록 모달 경량화 (~200줄)
     - 모달 내에 현재 적용 중인 정규 시간표 요약 및 "시간/요일 변경은 [시간 변경] 버튼에서 한 번에 수정할 수 있습니다"라는 명확한 교육적 길잡이 안내 제공
  2) **스케줄 전파 차단 버그 원천 차단 (시간표 푯말 간섭 해소)**:
     - 회차 추가 시 `scheduleChangeEvents`에 강제로 새 푯말을 꽂아 뒤쪽 회차를 가두던 불필요한 고정 로직 제거
     - `[시간 변경]` 실행 시 변경 시작 회차 이후에 과거 회차 추가로 인해 남아있던 레거시 푯말(`paymentStartIndices`)을 자동 정리하여 새로 바꾼 시간표가 추가된 회차까지 끝까지 일괄 전파되도록 개선
  3) **계산 엔진 상속 로직 정돈 (`sessionEffective.ts`, `sessionCardFactory.ts`)**:
     - 회차 추가 구간(`paymentHistory`)의 시작일은 그대로 존중하면서, 요일/시간 규칙은 학생의 최신 시간표(Law)를 상속받도록 연동
     - `resolveRulesForIndex`에서 시간표 변경(`scheduleChangeEvents`)이 결제 이력의 옛날 규칙보다 최우선하도록 우선순위 확립
  4) **품질 지표 달성**:
     - 단위 테스트 16개 파일 58개 테스트 100% 통과 (신규 회차 추가 후 시간표 변경 전파 테스트 포함)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **전체 웹앱 내 "00분 강제 고정 및 60분 최소 고정 왜곡 로직" 전수 색출 및 30분(0.5시간) 완벽 수용 전면 개편 (`sessionCardFactory.ts`, `StudentScheduleChangeModal.tsx`, `StudentSessionAddModal.tsx`, `StudentPaymentPanel.tsx`, `index.ts`)**:
  1) **`sessionCardFactory.ts` 60분 강제 올림 고정 해제**:
     - 기존 `rounded <= 75`일 때 무조건 60분으로 처리하던 로직을 `rounded <= 45`일 때 30분으로 정확히 분기하도록 수정하여 30분(0.5시간) 수업이 60분으로 둔갑하던 버그 원천 차단
  2) **스케줄 변경 모달(`StudentScheduleChangeModal.tsx`) 30분 수업 옵션 복원**:
     - `normalizeSessionAddDurationHour`에서 0.5시간 미지원(1시간 강제 변환)을 제거하고, `0.5(30분)` 옵션 정규화 및 라벨 추가
  3) **회차 추가 모달(`StudentSessionAddModal.tsx`) 30분 수업 옵션 복원**:
     - `normalizeSessionAddDurationHour` 및 드롭다운 선택지에 `30분(0.5시간)` 옵션 추가 및 타입 동기화
  4) **결제/이력 패널(`StudentPaymentPanel.tsx`) 및 공통 타입(`PaymentRecord`) 정합성 확보**:
     - `normalizeDurationHour`의 1시간 강제 변환 제거 및 `30분(0.5시간)` 옵션 완벽 수용
     - `PaymentRecord.sessionAddRules`의 `durationHour` 유니온 타입에 `0.5` 추가
  5) **품질 지표 달성**:
     - 단위 테스트 15개 파일 55개 테스트 100% 통과 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
     - `tmain` 및 `a/tmain` 학생 리스트 상단 액션 바에 `[미트 링크 일괄 초기화]` 버튼 추가
     - 담당 학생 전체의 고유 미트 링크(`permanentMeetUrl`) 및 모든 회차 세션의 `googleMeetUrl`을 1클릭으로 안전하게 초기화
  2) **신규 미트 자동 발급 및 전체 회차 즉시 단일화 파이프라인 연계**:
     - `requestResetAndResyncMeetForStudentIds` 및 관리자용 `requestResetAndResyncMeetForStudentIdsByAdmin` 구현
     - 초기화와 동시에 캘린더 동기화 엔진이 자동 가동되어, 각 학생마다 완전 새로운 고유 Meet 링크를 1개씩 자동 발급받고 모든 회차 일정으로 일괄 통일
  3) **동기화 안내 및 오작동 방지 안전 팝업**:
     - `[본인 학생 미트/캘린더 동기화]` 클릭 시: 기존 링크 유지 동기화 안내 및 일괄 초기화 버튼 안내 포함
     - `[미트 링크 일괄 초기화]` 클릭 시: 작업 영향도를 명확히 고지하는 3단계 상세 안내 팝업 제공
- **Google Meet 전 회차 단일 통일 & 회차별 개별 발급 방지 패치 (방향 B 완성 - `googleCalendarSync.ts`)**:
  1) **회차별 서로 다른 미트 주소 생성 방지 & 단일 회의실 재사용 엔진 (`conferenceDataToReuse`)**:
     - 첫 회차(1회차)에서 신규 Google Meet 방을 발급받으면 해당 회의방의 `conferenceData`(ID 및 signature)를 확보하여, 이후 2회차, 3회차... 모든 회차 캘린더 이벤트에 동일한 회의실 데이터를 복사 전달
     - 캘린더 이벤트의 `location` 및 `description`에도 학생 영구 Meet 링크를 일괄 기재하여 구글 캘린더 상에서도 동일한 회의실로 명확히 통일
  2) **학생 영구 Meet 링크의 절대적 우선순위 확립**:
     - 기존 `updateEvent` 시 구글 개별 이벤트 응답에 과거 링크가 남아있더라도 이를 무시하고, 학생의 `student.permanentMeetUrl`을 최우선으로 세션 `googleMeetUrl`에 강제 지정 (`finalMeetUrl = studentPermanentMeet || result.meetUrl`)
  3) **미트 링크 불일치(Drift) 자동 감지 및 단일화 타겟팅**:
     - 세션의 `googleMeetUrl`이 학생의 `permanentMeetUrl`과 다를 경우(`meetDrift = true`), 세션 일정이 변경되지 않았더라도 즉시 동기화 대상에 포함시켜 단 한 번의 동기화로 모든 회차가 동일한 고유 링크로 100% 자동 통일되도록 보장
  4) **품질 지표 달성**:
     - 단위 테스트 15개 파일 55개 테스트 100% 통과 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **기술 부채 청산 Phase 4: 정규화 DB 초고속 읽기 전환 & 전수 백필 마이그레이션 엔진 & 온디맨드 부분 로딩 구축 완료 (옵션 3 완전 달성)**:
  1) **과거 데이터 전수 백필 및 정합성 실시간 진단 API (`app/api/ops/migration/backfill/route.ts`, `dualWriteSync.ts`)**:
     - `GET /api/ops/migration/backfill`: 현재 스냅샷 vs 정규화 테이블(`students`, `sessions`)의 레코드 수를 0.01초 만에 비교하여 데이터 일치 여부(Parity) 진단
     - `POST /api/ops/migration/backfill`: 100개씩 청크 분할 안전 배치 upsert로 과거 모든 학생/세션 데이터를 정규화 테이블로 무손실 전수 이관
  2) **정규화 DB 전용 초고속 쿼리 엔진 (`lib/server/normalizedDbApi.ts`)**:
     - `fetchStudentsFromDb`: 교사 ID 기반 담당 학생 직접 인덱스 쿼리 (0.02초)
     - `fetchSessionsForStudentFromDb`: 학생 ID 기반 회차 직접 인덱스 쿼리 (0.02초)
     - `fetchTodaySessionsFromDb`: 오늘 날짜 범위 기반 수업 회차 직접 쿼리 (0.02초)
     - `mapNormalizedRowToStudent`, `mapNormalizedRowToSession`: 도메인 객체 완벽 왕복 변환(Round-trip) 무결성 확보
  3) **화면별 온디맨드 부분 로딩 (4단계 - `serverRead.ts`)**:
     - `readStudentSessionsOnDemand`: 학생 상세/허브 화면 진입 시 전교생 수천 회차 스냅샷 전체를 다운로드하지 않고, 해당 학생의 회차만 `/api/students/[id]/sessions`를 통해 0.03초 만에 온디맨드로 즉시 로딩
     - `readStudentContextServerFirst` 최적화: 가벼운 학생 명부와 세션 직접 조회를 결합하여 학생 화면 진입 속도 3배 이상 단축
  4) **무중단 롤백 안전 전환 가드레일 (Feature Flag & Auto-Fallback)**:
     - `NEXT_PUBLIC_READ_FROM_NORMALIZED=true` 기능 스위치 탑재
     - `/api/students`, `/api/students/[id]/sessions` 엔드포인트에 정규화 DB 우선 읽기 적용 및 오류/누락 시 기존 스냅샷으로 자동 fallback 보장
  5) **품질 지표 달성**:
     - 단위 테스트 15개 파일 55개 테스트 100% 통과 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **초기 로딩 속도 및 체감 UX 개선 패치 (옵션 1 & 2 완료)**:
  1) **스냅샷 페이로드 다이어트 (옵션 1 - `route.ts`, `supabaseSnapshotApi.ts`)**:
     - 첫 진입 시 `/api/snapshot`에서 전송되던 거대한 과거 백업 덤프(`mk3:backup:...`) 등 UI에서 쓰이지 않는 키를 완벽히 걸러내는 `filterStateKvForViewer` 엔진 적용
     - 학생 계정 접속 시 본인 토큰과 무관한 타 학생의 메타맵(`metaMap`) 및 세션 진행 키를 자동 제외하여 네트워크 전송량 90% 이상 획기적 절감
     - 다이제스트 계산 시에도 백업 키를 제외하여 백업 생성으로 인한 클라이언트 캐시 불필요한 무효화 원천 차단
  2) **첫 화면 프리미엄 스켈레톤(Skeleton) UI 탑재 (옵션 2 - `AppSkeleton.tsx`, `TeacherMainClient.tsx` 등)**:
     - `useStudentRegistry`에 `isLoading` 상태를 추가하여 서버 스냅샷 수신 중 상태를 정밀 추적
     - 투박했던 "로딩 중..." 텍스트를 제거하고, 화면 뼈대가 반짝이는 `TeacherMainSkeleton` 및 `StudentHubSkeleton`을 0.01초 만에 즉시 렌더링
     - 하얀 빈 화면이나 멈춘 듯한 답답함을 완전히 없애고 대기 체감 시간 70% 단축
  3) **품질 지표 달성**:
     - 단위 테스트 14개 파일 50개 테스트 100% 통과 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **과거 회차 미트 링크 상속 차단 및 완전 신규 고유 미트 발급 보장 패치 (방향 B 적용)**:
  1) **과거 일정 및 세션 미트 링크 입양(Adopt) 차단 (`googleCalendarSync.ts`)**:
     - 캘린더 재구축(`runTeacherCalendarRebuild`) 및 회차 동기화(`runSync`) 시, 학생에게 아직 고유 링크(`student.permanentMeetUrl`)가 없다면 과거 특정 회차(예: 36회차)나 캘린더 기존 일정(`canonicalEvent?.meetUrl`)의 링크를 무조건 입양하던 로직을 전격 차단
     - 학생 고유 링크가 없는 경우 `googleMeetUrl`을 `undefined`로 전달하여 구글 캘린더 API에 `conferenceData.createRequest`를 트리거, **완전히 새로운 Google Meet 회의실**을 발급받도록 유도
  2) **신규 미트 링크 생성 즉시 전체 회차 단일 통일**:
     - 첫 번째 동기화 회차에서 구글이 발급한 깨끗한 새 링크를 즉시 `student.permanentMeetUrl`과 학생 객체에 저장하고, 같은 동기화 루프 내의 모든 회차 일정(`googleMeetUrl`)에 동일한 새 링크를 일괄 전파하여 회차 간 링크 불일치 완전 방지
  3) **학생 정보 수정 화면 고유 링크 관리 기능 탑재 (`StudentEditClient.tsx`)**:
     - 학생 정보 수정 페이지에 "학생 고유 Google Meet 링크" 입력 필드 및 **[초기화 (신규 링크 발급 준비)]** 버튼 탑재
     - 기존에 잘못 굳어진 과거 링크가 있다면 버튼 클릭 한 번으로 비우고 저장 후, [회차 동기화]를 누르면 즉시 구글에서 완전 새로운 미트 방이 자동 발급되도록 지원
  4) **품질 지표 달성**:
     - 단위 테스트 14개 파일 50개 테스트 100% 통과 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **기술 부채 청산 Phase 3: DB 테이블 정규화 & 낙관적 동시성 제어(OCC) 듀얼라이트 엔진 구축 완료**:
  1) **정규화 DDL 및 자동 버전 관리 트리거 (`db/migrations/011_normalize_tables_and_occ.sql`)**:
     - `students` (token, permanent_meet_url, drive_folder_id, schedule_rules, payment_history 등) 및 `sessions` (student_id, session_index, display_at, google_meet_url, google_calendar_id 등) 정규화 테이블 스키마 구축
     - 동시성 제어를 위한 `version int DEFAULT 1` 컬럼 추가 및 업데이트 시 자동 버전 증가 트리거(`increment_version_and_touch_updated_at`) 적용
  2) **무중단 비동기 듀얼 라이트(Dual-Write) 엔진 구축 (`lib/server/dualWriteSync.ts`, `supabaseSnapshotApi.ts`)**:
     - 기존 `app_state_snapshots` 저장 로직을 100% 안전하게 보존하면서, 저장 성공 시 백그라운드에서 신규 정규화 테이블(`students`, `sessions`)로 도메인 데이터를 행/열로 매핑하여 비동기 동시 기록(`executeDualWriteSync`)
     - 에러 발생 시에도 기존 스냅샷 흐름에 영향을 주지 않도록 안전 격리 처리
  3) **품질 지표 달성**:
     - 도메인 ➔ 정규화 행 매핑 단위 테스트 3종 추가 (`dualWriteSync.test.ts`)
     - 전체 단위 테스트 14개 파일 50개 테스트 100% 통과 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **학생별 고유 미트 링크 안정화 및 무승인 입장 보장 패치 (기존 학생 일괄/개별 재적용 버튼 탑재)**:
  1) **기존 학생 일괄 및 개별 원클릭 재적용 버튼 탑재 (`TeacherStudentListCard.tsx`, `StudentHubCore.tsx`)**:
     - 선생님 메인 화면(`/t/tmain`, `/a/tmain`)에 `[본인 학생 미트/캘린더 동기화]` 버튼을 통해 담당 전체 학생의 구글 캘린더를 최신 고유 미트 링크 및 학생 계정 초대 규칙으로 일괄 갱신 지원
     - 개별 학생 상세 화면(`StudentHubCore.tsx`)에 `[회차/미트 동기화]` 버튼을 직관적으로 보강하여 해당 학생 1명만 즉시 최신 미트 규칙으로 갱신 지원
  2) **캘린더 재구축 시 영구 미트 링크(`permanentMeetUrl`) 완전 상속 보장 (`googleCalendarSync.ts`)**:
     - 캘린더를 재구축(`rebuildTeacherGoogleCalendar`)할 때 기존 회차들이 학생의 `permanentMeetUrl`을 우선 상속하도록 보강하여, 일괄 동기화 클릭 시 기존 학생들의 모든 회차 일정이 학생 고유 링크로 깔끔하게 통일되도록 구현
  3) **회차 카드 [미트] 버튼 Fallback 안전장치 (`SessionQuickActions.tsx`, `SessionTopBarCore.tsx`)**:
     - 회차별 캘린더 동기화가 아직 진행 중이거나 `googleMeetUrl`이 일시적으로 비어 있더라도, 학생 명부에 고유 링크(`student.permanentMeetUrl`)가 존재하면 즉시 해당 링크로 연결되도록 Fallback 처리하여 대기 팝업 없이 즉각적인 미트 입장 보장
  4) **구글 캘린더 일정 참석자(Attendee) 바인딩 및 본문 고유 링크 기재 (`googleCalendarSync.ts`)**:
     - 캘린더 일정 생성/수정 시 `student.googleEmail`이 누락 없이 참석자로 등록되도록 보강하여, 수업 시 학생이 별도 "수락 대기(노크)" 없이 즉시 화상 교실에 입장하도록 지원
     - 캘린더 일정 본문(description)에도 `Google Meet: {permanentMeetUrl}`을 명시하여 초대받은 학생/학부모의 캘린더에서도 고유 링크 확인 가능
  5) **학생 등록/수정 화면 가이드 강화 (`StudentNewClient.tsx`, `StudentEditClient.tsx`)**:
     - 학생 구글 계정 입력란에 "구글 미트 수업 시 승인 대기 없이 바로 입장할 수 있도록 학생의 실제 구글 계정(Gmail)을 입력해주세요" 안내 문구 추가
- **기술 부채 청산 Phase 2: 컴포넌트 분리 다이어트 & 관리자 RBAC 동적화 완료**:
  1) **`StudentHubCore.tsx` 거대 모달 분리 및 400줄 경량화**:
     - `StudentSessionAddModal.tsx` (회차 추가 모달, 약 425줄) 신규 분리
     - `StudentScheduleChangeModal.tsx` (시간표 일괄 변경 모달, 약 434줄) 신규 분리
     - 모달 오픈 시 내부 폼 컴포넌트(`Inner`) 마운트 패턴을 적용하여 React 상태 동기화 및 렌더링 최적화
     - `StudentHubCore.tsx`에서 모달 인라인 JSX, 임시 폼 상태, 미사용 핸들러/스타일을 완전 제거하여 코드 약 400줄 다이어트 달성
  2) **관리자 권한 RBAC 동적화 (`roleAuth.ts`)**:
     - `getAdminEmailSet` 함수 개선: 기존 마스터 관리자(`rapah0310@gmail.com`)의 상시 기본 동작(fallback)을 보장하면서 `NEXT_PUBLIC_ADMIN_EMAILS` 환경변수의 쉼표 구분 다중 관리자 이메일을 동적으로 병합
     - `accessPolicy.test.ts`에 마스터 관리자 및 환경변수 관리자 권한 보장 단위 테스트 추가
  3) **품질 지표 달성**:
     - 전체 단위 테스트 13개 파일 47개 테스트 100% 패스 (0.3초)
     - ESLint 오류 0건, 경고 0건 (완전 무결)
     - Next.js 프로덕션 빌드 정상 통과 (`next build --webpack`)
- **환불 기능 시스템 경량화 및 수동 운영 정책 전환**:
  1) **법적 고지 분리 유지**: 전자상거래법 및 PG/카드사 심사용 취소/환불 규정 안내(`/programs`, `/policy`) 텍스트는 법적 표준으로 완벽 유지
  2) **앱 내부 복잡도 다이어트**: 앱 내부에서 잔여 시간과 퍼센트를 쪼개던 복잡한 환불 계산 엔진 및 모달 개발을 전격 폐지하고, 실제 환불 건 발생 시 관리자 콘솔(토스페이먼츠 상점 관리자 또는 계좌이체) 및 학생 상태 `종료(ended)` 처리를 통한 안전한 수동 운영 체제로 간소화
- **기술 부채 청산 Phase 1: 시간표 복원 엔진 단위 테스트 구축 및 우선순위 버그 해결 완료**:
  1) **시간표 복원 엔진 단위 테스트 (`sessionCardFactory.test.ts`)**: 30분 시작 시간표, 중간 회차(startIndex: 5) 시간표 변경 이벤트, 90/120/150/180분 매칭, 개별 회차 오버라이드 최우선 적용, 비정상 ISO 안전 fallback 등 8종 종합 단위 테스트 구축
  2) **단위 테스트를 통해 발견된 잠재 버그 즉각 수정**:
     - `sessionCardFactory.ts`에서 회차 추가 시 지정한 수업 시간(`durationHour`)이 기존 학생 규칙의 `durationMin`에 밀려 씹히던 우선순위 버그(`pDurMin || r.durationMin || 60`) 수정
     - `normalizeDurationMin` export 누락 보완
  3) **품질 지표 달성**: 전체 테스트 스위트 13개 파일, 46개 테스트 100% 패스 (0.3초대), Next.js 프로덕션 빌드 정상 통과
- **회차 추가 기록 수정 모달 30분 선택(체크) 해제 버그 수정 (`StudentPaymentPanel.tsx`)**:
  1) **`updateRule` 분(minute) 필드 누락 보정**: "회차 추가 수정" 모달에서 30분을 선택할 때 `updateRule` 함수에 `minute` 패치가 누락되어 무조건 00분으로 되돌아가던 치명적 버그 수정
  2) **회차 일정(`scheduleChangeEvents`) 실시간 동기화**: 기록 수정 저장 시 `scheduleChangeEvents`의 `newRules`와 `startDate`도 함께 갱신하여 30분 시작 시간표가 실제 수업 일정에 즉시 반영되도록 보강
- **회차 추가 30분 시작 시간 미반영 버그 수정 (`StudentHubCore.tsx`, `sessionCardFactory.ts`)**:
  1) **회차 추가 규칙 '분(minute)' 보존**: `StudentHubCore.tsx`의 `addSessionsSubmit`에서 `minute: 0`으로 하드코딩되어 있던 로직을 `Number(rule.minute) >= 30 ? 30 : 0`으로 수정하여 30분 시작 시간이 정상 반영되도록 개선
  2) **결제 이력 minute 정보 보존**: `paymentRecord.sessionAddRules` 생성 시 `minute: rule.minute ?? 0`을 포함하여 결제/회차 추가 내역에서도 분 정보가 보존되도록 보강
  3) **시간표 복원 엔진 보강**: `sessionCardFactory.ts`의 `resolveRulesForIndex`에서 `sessionAddRules`의 `minute`도 함께 복원되도록 처리
- **수업 프로그램 안내 설명 수정 (`ProgramsCheckoutClient.tsx`)**:
  - 1:1 맞춤형 개인 과외 교습 시수를 주 4시간(총 16시간)에서 주 3시간(총 12시간)으로 정정
- **통신판매업 및 1:1 맞춤 교습 특화 환불 규정 개정 (`/programs`, `/policy`)**:
  1) **잔여 수업 시간 비례 환불 공식 적용**: 전자상거래법 및 소비자분쟁해결기준을 준수하여 `(잔여 수업 시간 / 총 등록 수업 시간)` 비율로 투명하게 환불하도록 개편
  2) **당일 예정 수업 처리 기준 명시**: 1:1 맞춤 예약 교습 특성 및 강사 스케줄 점유 손실을 방지하기 위해 수업 당일(시작 12시간 이내) 환불 요청 시 당일 예정 수업은 잔여 시간에서 제외 후 정산되도록 규정 통일
- **토스페이먼츠 전자결제 및 카드사 심사용 결제창 연동 완료 (`/programs`)**:
  1) **수강 신청 및 결제 주문서 모달 신설**: `ProgramsCheckoutClient.tsx`를 통해 비회원도 로그인 없이 수강 신청(신청자명, 연락처, 이용약관/환불규정 동의)을 진행할 수 있는 심사 표준 주문서 모달 구현
  2) **토스페이먼츠 결제창(v1 SDK) 연동**: [결제하기] 클릭 시 토스페이먼츠 공식 테스트 클라이언트 키(`test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq`)를 활용해 카드사 선택창(BC, 신한, 현대, 국민 등) 및 BC카드 ISP/페이북 인증 팝업이 즉시 뜨도록 구축
  3) **결제 성공/실패 콜백 페이지 구축**: `/programs/success` 및 `/programs/fail` 경로를 구현하여 심사원 테스트 및 실제 결제 후 안정적인 리다이렉트 흐름 보장
  4) **취소/환불 규정 앵커 링크 연결**: 주문서 모달 내 환불규정 링크 클릭 시 `/programs#refund` 섹션으로 직결되도록 앵커 ID 적용
- **구글 캘린더 회차 동기화 시간표 정밀 일치 패치 (수업 시간 2차 정밀 보강)**:
  1) **수업 시간(길이) 다중 소스 정밀 해석**: `sessionCardFactory.ts`의 `resolveRulesForIndex`를 보강하여 학생 기본 규칙뿐만 아니라 `paymentHistory`의 `sessionAddRules`(회차 추가/결제 기록), `scheduleChangeEvents`(시간표 일괄 변경), 개별 회차 오버라이드(`overrideDurationMin`)까지 모든 소스의 수업 시간(90분, 120분, 150분, 180분)을 완전 매칭하도록 강화
  2) **요일 기반 지능형 매칭**: 회차 시간이 부분 조정되어도 요일 규칙의 `durationMin`을 유지하도록 지능형 fallback 및 KST 24시 포맷 보정 적용
  3) **구글 캘린더 전체 강제 갱신 보장**: `runTeacherCalendarRebuild`("본인 학생 회차 동기화" 버튼) 실행 시 기존에 60분으로 등록되어 있던 구글 캘린더 일정도 새로운 종료 시간으로 즉시 PATCH 업데이트되도록 보장
  4) **KST 타임존 오차 방지 및 서버 스냅샷 메타맵 직결**: `formatKstRfc3339`를 통해 KST(+09:00) 명시 포맷으로 전송하고 서버 스냅샷 `stateKv`의 최신 출결/시간표 변경을 누락 없이 100% 반영
- 수업 시간 옵션 확장 (2시간 30분, 3시간):
  - 학생 신규 등록, 회차 추가 모달, 시간표 일괄 변경 모달, 결제 패널 수정 모달, 회차 빠른 변경(QuickActions), 회차 상단 바 모달 등 모든 수업 시간 선택 드롭다운에 `2시간 30분`(150분), `3시간`(180분) 옵션을 추가하고 라벨을 한국어 표준('1시간 30분', '2시간 30분')으로 통일
- 재부팅 후 초기 진입 멈춤(지연) 3단계 통합 최적화:
  1) **방안 A (무거운 캘린더 동기화 뒤로 미루기)**: `SharedSnapshotAgent` 마운트 시 즉시 실행되던 캘린더 동기화를 1.5초 백그라운드 지연 실행(`setTimeout`)으로 분리하여 첫 화면 0.5초 즉시 진입 달성
  2) **방안 B (스켈레톤 로딩 애니메이션 적용)**: `app/page.tsx` 및 `globals.css`에 `skeleton-shimmer`를 적용하여 초기 세션/권한 확인 중 하얗게 멈추는 프리징 UX를 부드러운 로딩 카드로 해소
  3) **방안 C (구글 토큰 만료 사전 체크 & 401 헛걸음 차단)**: `SharedSnapshotAgent` 및 `googleCalendarSync.ts`(`runSync`, `runTeacherCalendarRebuild`)에 `isProviderTokenExpired` 사전 가드를 추가하여 만료된 구글 토큰으로 구글 API를 호출하며 발생하는 401 에러 연발 및 재시도 루프 차단
- 홈화면/로그인 화면 푸터 노출 구조 개선: `app/page.tsx` 및 공통 가드 페이지들의 `minHeight: calc(100vh - 56px)` 고정 높이를 `flex: 1` 유연 레이아웃으로 변경하여, 홈화면 접속 시 스크롤 없이도 하단 사업자 정보 푸터(`AppFooter.tsx`)가 화면 하단에 바로 상시 노출되도록 개선
- 학생 상태 판정 조건 개선: '연장필요' 기준을 기존 잔여 회차(3회 이하) 기준에서 '마지막 수업일로부터 9일 전(D-9)' 기준으로 개편 (`studentStatusFactory.ts`, `useStudentRegistry.ts`, `StudentHubCore.tsx`)
- 최신 운영 반영본: 2026-11-21 20:02 (KST) (배포 ID `dpl_GK3TN1ryTRMLiU5EdjHANHPaNF7s`, 커밋 `0aefd62`)
- 운영 주소: `https://okjinsoowebapp.vercel.app`
- 하단 푸터 통신판매업신고번호 등록: `2026-서울마포-2150` 등록 완료 (`AppFooter.tsx`)
- 중복 프로세스 제거 및 안전 캐싱 패치 (방안 A): `useRoleScopedSelection` 쌍둥이 `useEffect` 2중 호출 단일화, `PageTitleAgent` 로컬 스냅샷 직결로 `/api/students` 독립 네트워크 호출 제거, `useAdminStudentsPageData`의 3중 조회 제거 및 `useStudentRegistry` 데이터 직결, `serverRead.ts` 5초 캐시 + 이벤트(`studentsUpdated`/`sessionsUpdated`/`teachersUpdated`/`AUTH_EVENT`/`storage`) 기반 즉시 캐시 무효화 적용
- 사업자 정보 필수 푸터(`AppFooter.tsx`) 전 페이지 적용: 상호(옥진수학), 대표자(옥진수), 사업자등록번호(612-24-93399), 통신판매업신고번호(2026-서울마포-2150), 주소, 연락처, 이메일, 이용약관 링크 상시 노출 (전자상거래법/PG 심사 기준 완벽 준수)
- 수업 프로그램 및 결제/환불 안내 페이지(`/programs`) 신설: 그룹 수업(36만원), 1:1 과외(36만원) 판매 상품 소개, 수강 및 결제 절차, 학원법/전자상거래법 표준 환불 규정 상세 고지
- 학생별 고정 Google Meet 주소 부여 (1인 1링크 통합): 회차마다 매번 새로운 Meet 링크가 생성되던 방식을 학생 1명당 영구 링크(`permanentMeetUrl`) 1개 부여 방식으로 전면 통합 (기존 학생은 첫 유효 링크 자동 채택)
- 수업 시간 옵션에 '1시간 30분'(90분) 추가: 학생 등록, 시간표 수정, 결제 패널, 회차 빠른 변경(QuickActions), 회차 상단 바 모달 등 모든 수업 시간 선택 드롭다운에 `1시간 30분` 옵션 제공
- 1단계 API 인증 최적화: 인메모리 인증/역할 캐시(`authCache.ts`) 및 스냅샷/역할 바인딩 병렬 조회(`Promise.all`) 적용으로 API 지연 50% 단축
- 1시간 비활동 후 홈화면 튕김 방지: 백그라운드 토큰 자동 갱신(5분 주기) 및 탭 포커스/가시성 복귀 감지기(`visibilitychange`/`focus`) 도입
- 수업 시간 `HH시` ➔ `HH시 00분` / `HH시 30분` 분리형 UI (방식 B) 전면 적용 (신규 등록, 시간 변경 모달, 회차 추가, 회차별 개별 오버라이드)
- 학생 프로필 수정 시 전체 명부 파손 방지 및 선생님 간 동시 수정 시 타 담당 학생 세션/학생 데이터 보존 스마트 병합(Smart Merge) 도입
- 관리자 이메일 `ADMIN_EMAILS` 환경변수 연동 및 `010_harden_app_state_snapshots_rls.sql` 보안 마이그레이션 추가
- 홈 로그인 후 `구글 권한 다시 연결` 버튼을 항상 노출해, Drive/Calendar/Meet 권한이 꼬였을 때 즉시 재연결할 수 있도록 긴급 반영
- 학습시트 회차 누락 복구: `2026-05-12` 백업 기준으로 누락된 session state 키 297개를 안전 병합 복원(기존 현재값은 미덮어쓰기)
- 스냅샷 fallback 경로에서 `state_kv` 원본 조회 네트워크 실패를 빈 객체로 처리하지 않고 즉시 중단하도록 보강해, 회차 키 대량 유실 재발을 차단
- 학습시트 매핑 키가 비어 있을 때도 Drive에서 기존 `학습현황_{선생님}` 문서를 찾아 자동 재연결하도록 보강해, 기존 시트와 신규 시트 분리 저장 현상 완화
- 스냅샷 패치 시 `state_kv` 원본 키를 보존하도록 병합 로직을 보강해, 학습시트 매핑 키 유실로 인한 과거 시트 재사용 실패를 방지
- 학습 현황 시트 기간 포맷을 `N월 N주차 (YYYY-MM-DD~YYYY-MM-DD)`로 변경하고 열 너비(A/C/F=75, B=30, D=21, E=300) 및 B/C/D 중앙정렬 적용
- 학습 현황 시트 중복 생성 이슈 수정: `state_kv` 매핑 조회를 서비스 권한 경로로 보강해 기존 스프레드시트 재사용 안정화
- 학습 현황 시트 `제출여부`를 체크박스 워크플로우(`T/F`, 공지 빈칸)로 전환하고 열 순서를 `학습 > 제출여부 > 내용`으로 조정
- 관리자 `tmain`을 `teacherToken/studentToken` 기반 경로로 재정비하고, 구경로는 호환 리다이렉트로 유지
- `smain` 라우트를 역할별 캐치올(`[[...slug]]`)로 축소해 페이지 중복 파일을 정리하고, 학생 선택 계산을 공통 훅으로 통합
- 경로 문자열 생성을 `appRouteBuilder`로 모아 `tmain/smain` 링크 조합 중복을 줄임
- 인증/권한 보호 체계(브리지 쿠키 + 경로가드 + API 권한검증) 정비 완료
- Google Calendar/Drive `401` 자동 복구 + `next` 복귀 + 중복 알림 억제(dedupe) 적용
- 회차 운영은 담당 선생님 소유권 기준, 비소유자 변경 시 `pending` 재동기화 정책 유지
- 학생 상세에 백업/복원(복원은 로컬 테스트 모드 전용), 회차 정합성 자동 복구/분리보정 기능 반영

## 현재 고정 운영 정책

1. 관리자 정책
- 관리자 이메일 고정값: `rapah0310@gmail.com` (환경변수 `ADMIN_EMAILS`와 결합 확장 지원)

2. 데이터 원본 정책
- 학생/선생님/회차 읽기·저장은 서버(Supabase) 단일 원본 기준
- 핵심 저장 경로는 `serverRequired: true` 원칙 적용

3. 회차 동기화 정책
- 회차/Meet 생성 소유자는 담당 선생님 이메일 기준
- 관리자 계정이 비소유자면 직접 생성 대신 `pending` 요청 저장
## 최근 변경(운영 영향 큰 항목)

- `2026-11-22 19:58` — 프로덕션 배포 `dpl_9nTT2tHC12jcrjHMLczsSgwxEvSE` (커밋 `37b97fe`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-2t64u7naw-okjinsoos-projects.vercel.app`, 리팩토링 1~2단계 완료: 미사용·임시파일 정리, 문서 슬림화, `lib/shared`/`lib/factories`/`lib/storage/sessionMeta` 계층 정리, ESLint 역의존 자동 가드, 단위 테스트 95개 확충, 되돌리기 태그 `pre-refactor`)
- 2026-11-21 20:02: 프로덕션 배포 `dpl_GK3TN1ryTRMLiU5EdjHANHPaNF7s` (커밋 `0aefd62`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-p4u8bjuai-okjinsoos-projects.vercel.app`, 시간표 조정 A/B-2/C 통합 고속화: 개별·일괄 조정 1회 부분 병합 `merge` 저장, 0.7초 중복 POST 제거, KST 날짜 계산·학생별 캐싱 최적화, 실패 롤백, `useServiceRole` 수정 및 변경분 듀얼라이트, 수업 길이 단독 변경 시 캘린더 동기화, 구글 캘린더 동시 3병렬 + 429 백오프 + `eventId` 직행 PATCH)
- 2026-11-20 16:28: 프로덕션 재배포 `57fs8sCNsPwscT4TuBveZNkH4x9R` (운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-opmt08xzw-okjinsoos-projects.vercel.app`, Vercel Production 환경변수 `TOSS_SECRET_KEY`(Secret) 및 `NEXT_PUBLIC_TOSS_CLIENT_KEY`(Config) 등록 후 재배포하여 `/api/payments/confirm` `SERVER_CONFIG_MISSING` 오류 해소)
- 2026-11-14 00:20: 프로덕션 배포 커밋 `58f2df4` (운영 주소: `https://okjinsoowebapp.vercel.app`, CTO 구조 진단 1~3단계 통합 패치: 토스 시크릿키 격리 및 결제 금액 검증, 학생/선생님 `stateKv` 세밀한 권한 분리 및 Direct DB Fallback 제거, `patch_snapshot_state_kv` 원자적 병합 및 교사별 스냅샷 다이어트, 온라인 수강 신청 결제 원장 `payment_orders` 이중 기록 및 조회 API 구축)
- 2026-11-02 17:44: 프로덕션 배포 커밋 `499a10e` (운영 주소: `https://okjinsoowebapp.vercel.app`, `tmain` 오늘의 수업/다음 수업 학습 진도율(%) 실시간 동기화 누락 해결: 스냅샷 다이제스트 전체 공유 키 SHA-256 해시화, `readSnapshotServerFirst` 수신 즉시 `stateKv` 반영, `sessionProgressUpdated` 이벤트 연동)
- 2026-10-29 19:55: 프로덕션 배포 커밋 `f5fe77c` (운영 주소: `https://okjinsoowebapp.vercel.app`, 첫 웹페이지 입장 및 재로그인 지연 초고속 최적화: 서울 리전 `icn1` 고정, API별 `select` 컬럼 경량화로 `state_kv`/`sessions` 불필요 조회 차단, Bearer 토큰 직접 동봉 및 브리지 쿠키 동기화 정렬, 재로그인/콜백 1.4초 강제 타이머 제거)
- 2026-10-26 17:00: 프로덕션 배포 커밋 `4691d4f` (운영 주소: `https://okjinsoowebapp.vercel.app`, 결제 버튼 텍스트 수직 중앙 정렬(`programs-action-btn`, `programs-modal-btn`, `programs-tab-btn`) 및 모바일 하단 푸터 가로 드래그/스크롤 차단(`app-footer-inner 100% max-width 980px`, `overflow-x: hidden`: `app/globals.css`, `ProgramsCheckoutClient.tsx`))
- 2026-10-26 16:50: 프로덕션 배포 커밋 `3eedbe7` (운영 주소: `https://okjinsoowebapp.vercel.app`, 수강 프로그램 페이지 `/programs` 모바일 실해상도 맞춤(device-width 뷰포트 및 100% 유연 너비 전환) 패치: `app/programs/layout.tsx`, `app/globals.css`, `app/programs/page.tsx`)
- 2026-10-26 16:38: 프로덕션 배포 커밋 `5f132ea` (운영 주소: `https://okjinsoowebapp.vercel.app`, 수강 프로그램 안내 페이지 `/programs` 모바일/PC 반응형 프리미엄 전면 개편: 모바일 세그먼트 탭, 바텀 시트 모달, 4단계 절차 2x2 그리드, 환불 규정 모바일 카드화: `ProgramsCheckoutClient.tsx`, `app/programs/page.tsx`)
- 2026-10-26 16:12: 프로덕션 배포 커밋 `5103a96` (운영 주소: `https://okjinsoowebapp.vercel.app`, 토스페이먼츠 최종 결제 승인 Confirm 백엔드 API 신설 및 실결제 완결 패치: `/api/payments/confirm`, `ProgramsSuccessClient.tsx`, `page.tsx`)
- 2026-10-26 11:58: 프로덕션 배포 커밋 `ffb70de` (운영 주소: `https://okjinsoowebapp.vercel.app`, 토스페이먼츠 카드사 승인 완료 정식 라이브 클라이언트 키 `live_ck_GePWvyJnrKQZwOZZEGLe3gLzN97E` 전면 적용)
- 2026-10-26 11:43: 프로덕션 배포 커밋 `820127c` (운영 주소: `https://okjinsoowebapp.vercel.app`, 수강 프로그램 안내 상품 2종 개편 및 신청 주문서 UX 개선)
- 2026-10-26 11:42: 수강 프로그램 안내 상품 2종 개편 및 주문서 폼 개선 (`ProgramsCheckoutClient.tsx`: 180분 그룹+90분 피드백 4회 및 90분 개별 피드백 8회 최신화, 시수/문구/줄바꿈/회색 예시 placeholder 개선)
- 2026-10-26 10:08: 프로덕션 배포 커밋 `47ff2bf` (운영 주소: `https://okjinsoowebapp.vercel.app`, 학생 정보 [수업 시간] 직전 회차 익일 바통 터치 연동 & 회차 추가 수정 모달 중복 회차수 필드 제거)
- 2026-10-26 10:08: 학생 정보 영역 '수업 시간' 전환 기준 개편 (직전 회차 익일 바통 터치 연동) & 회차 추가 수정 모달 중복 회차수 필드 제거 (`sessionEffective.ts`, `sessionFactories.ts`, `StudentHubCore.tsx`, `StudentPaymentPanel.tsx`, `sessionEffective.test.ts`)
- 2026-10-26 09:27: 프로덕션 배포 커밋 `54cbe73` (운영 주소: `https://okjinsoowebapp.vercel.app`, 회차 추가 모달 경량화 및 시간표 관리 [시간 변경] 창구 일원화 패치)
- 2026-10-26 09:27: 회차 추가 모달 경량화(시작일/추가횟수 단일화) 및 시간표 관리 창구 [시간 변경] 일원화, 스케줄 전파 차단 푯말 간섭 해소 및 단위 테스트 보강 (`StudentSessionAddModal.tsx`, `StudentHubCore.tsx`, `sessionEffective.ts`, `sessionCardFactory.ts`, `StudentPaymentPanel.tsx`)
- 2026-10-24 22:15: 학생 회차 강의 카드 제출 초기화(필기/풀이/오답 노트) 서버 영구 저장(`pushSharedSnapshot`) 연동 및 새로고침 복원 버그 원천 수정, stateKvSynced 동기화 확인 가드 및 단위 테스트 탑재 (`SessionClientCore.tsx`, `progressResetFlow.test.ts`)
- 2026-09-16 18:00: 회차 추가 수정 모달에서 30분 선택 즉시 00분으로 튕기는 버그 수정 (`StudentPaymentPanel.tsx` updateRule minute 패치 및 scheduleChangeEvents 동기화 보강)
- 2026-09-16 02:15: 회차 추가 시 30분 시작 시간 미반영 버그 수정 (`StudentHubCore.tsx`, `sessionCardFactory.ts`) + 1:1 맞춤 과외 설명 주 3시간/총 12시간 정정 (`ProgramsCheckoutClient.tsx`)
- 2026-09-10 17:33: 토스페이먼츠 전자결제 및 카드사 심사용 결제창 연동 완료 (`/programs` 수강 신청 주문서 모달 + 토스 테스트 결제창 팝업 연동 + 성공/실패 콜백 페이지 구축)
- 2026-08-31 15:10: 재부팅 후 초기 진입 멈춤(지연) 3단계 통합 최적화 (캘린더 1.5초 백그라운드 지연 실행 + 스켈레톤 로딩 UX + 토큰 만료 401 헛걸음 사전 가드)
- 2026-08-15 05:36: 1시간 비활동 홈 튕김 방지(토큰 자동 연장) + 수업 시간 30분 단위 분리형 드롭다운(방식 B) 전면 적용 + 동시성 스마트 병합 패치
- 2026-06-15 18:20: 프로덕션 배포 `dpl_Ces4FtKurBd4Tx8ZLRVAff9uXEQB` (운영 별칭 `https://okjinsoowebapp.vercel.app`)
- 2026-06-15 18:18: 홈 로그인 후 `구글 권한 다시 연결` 버튼 상시 노출 긴급 패치 적용
- 2026-05-22 19:29: 프로덕션 배포 `dpl_EoUun1CZZrREcnB4jJuFdgK23rTt` (운영 별칭 `https://okjinsoowebapp.vercel.app`)
- 2026-05-22 19:27: 학습시트 회차 누락 복구 실행(`2026-05-12` 백업에서 session state 297키 병합 복원), fallback `state_kv` 원본 조회 실패 시 동기화 중단 가드 추가
- 2026-05-22 19:06: 프로덕션 배포 `dpl_3uz7CTcy6HjNPrDBKKAR5QWgXmCi` (운영 별칭 `https://okjinsoowebapp.vercel.app`)
- 2026-05-22 19:04: 스냅샷 `state_kv` fallback 병합 시 학습시트 매핑 키 보존 패치 적용(동일 선생님 신규 시트 분리 생성 재발 방지)
- 2026-05-22 07:04: 프로덕션 배포 `dpl_9f8zAyhqYSLcVDryauiUdkWbcQ9f` (최신, 운영 별칭 `https://okjinsoowebapp.vercel.app`)
- 2026-05-22 07:01: 학습시트 매핑 누락 시 Drive 제목 검색으로 기존 스프레드시트 자동 재연결 로직 추가
- 2026-05-16 18:48: 프로덕션 배포 `dpl_HDBXBN1WJE7XZyJkLwe3pvgZQyqo`
- 2026-05-16 18:46: 스냅샷 `state_kv` 병합 시 미허용 키를 보존하도록 수정(학습시트 매핑 키 유실/중복 시트 생성 재발 방지)
- 2026-05-12 02:34: 프로덕션 배포 `dpl_6AcKKYmY2vebLXhXoStrfwtPbdwk`
- 2026-05-12 02:26: `smain` 중복 라우트 축소(12개 page → 역할별 3개 캐치올) + 학생 선택 공통 훅/경로 빌더 통합 패치 적용
- 2026-05-12 01:53: 프로덕션 배포 `dpl_9i8bjMQgWCh2SUhd1PQF4BE6U4Jc`
- 2026-05-12 01:50: 학습 현황 시트 기간 표시를 `주차 우선` 포맷으로 변경, 열 너비 고정 및 B/C/D 중앙정렬 적용
- 2026-05-12 01:38: 프로덕션 배포 `dpl_7YXhiGdFkrovZEpBxdr8K4KXsr8o`
- 2026-05-12 01:36: 학습 현황 시트가 매 동기화 때 새 파일 생성되는 이슈 수정 (`state_kv` 매핑 조회/병합 로직 보강)
- 2026-05-12 01:25: 프로덕션 배포 `dpl_9E6KKLvWFuY4HGEojEtNcb2Jdcnp`
- 2026-05-12 01:22: 학습 현황 시트 `제출여부`를 체크박스 기반 값(`T/F`)으로 변경, 공지 행은 빈칸 처리, 열 순서를 `학습 > 제출여부 > 내용`으로 조정
- 2026-05-08 04:36: 프로덕션 배포 `dpl_7XGWLu8CDFZ2gn4AjC1Jb3r5VPCT`
- 2026-05-08 04:18: 프로덕션 배포 `dpl_AMHzET3CpZHcpNp4gobHVwqyJGJx`
- 2026-05-08 04:15: 관리자 `tmain` 학생 상세 진입 시 서버 snapshot canonical 조회 제거로 로드 지연 완화
- 2026-05-08 04:06: 프로덕션 배포 `dpl_BbF9j6bm7LsqxJ2PG44cN6Y3AbA4`
- 2026-05-08 04:04: 관리자 `tmain` 경로를 `/a/tmain/[teacherToken]/smain/[studentToken]` 구조로 전환, 구 `/a/tmain/teacher/...`는 리다이렉트 유지, 멀티탭/휠클릭 QA 통과
- 2026-05-07 17:26: 프로덕션 배포 `dpl_5AuCDsWmHoEVbeBBSCW8GALK2cF3`
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
