# Project Status (Latest)

기준 시각: 2026-11-27 20:32 (KST)  
대상 프로젝트: `v1`  
운영 주소: `https://okjinsoowebapp.vercel.app`  
최신 운영 배포본: `2026-11-27 20:30 (KST)` (`dpl_GNE1ySyqmK1ycZDQdmbvq72nSvY8`, 커밋 `ecaed9c`)

---

## 1분 요약 (현재 확정 상태)

- **보안 점검(ponytail-audit) Must fix 6건 패치 (2026-11-27, 브랜치 `fix/security-must-fix` → `main`, 운영 배포 완료 `dpl_GNE1ySyqmK1ycZDQdmbvq72nSvY8`)**:
  - `app/api/snapshot/route.ts`: 미등록(guest)·명단 미연결 학생/선생님 GET은 `403 forbidden`(이전엔 전체 명단·회차 반환). `?stateKey=` 단일 조회도 `filterStateKvForViewer`를 거쳐 결제 장부(`server:payment_orders_v1`)·타 학생 키 차단
  - `lib/security/requestAuth.ts`: `proxy.ts` 역할 판별의 스냅샷 대체 조회를 service role 키로 읽도록 변경(015 적용 대비)
  - `app/api/payments/confirm/route.ts`: `ALREADY_APPROVED`(결제 완료 화면 새로고침) 시 토스 `GET /v1/payments/{paymentKey}`로 실제 결제 정보를 다시 받아 기록. 조회 실패 시 장부를 덮어쓰지 않음(이전엔 오류 응답으로 승인 시각·영수증 소실)
  - `db/migrations/015_lockdown_snapshot_table_and_rpc.sql`: `app_state_snapshots`의 authenticated 읽기/쓰기 정책 제거·권한 회수, `patch_snapshot_state_kv` 실행 권한 service_role 전용. **⚠️ 아직 Supabase에 미적용 — SQL Editor에서 직접 실행 필요**(적용 전 Vercel `SUPABASE_SERVICE_ROLE_KEY` 존재 확인)
  - 테스트 +2(guest 403, 학생 stateKey 필터), **24개 파일 139개 테스트 통과**, lint 0건, 프로덕션 빌드 정상. 운영 확인: 홈 200, 비로그인 `/api/snapshot` 401. 로그인 계정별 브라우저 확인은 아직 안 함
  - 남은 점검 항목(Should fix): 결제 장부 백업 비상 경로의 전체 `state_kv` 덮어쓰기(`paymentOrderStore.ts:182-194`), 학생에게 전체 선생님 정보 전송, 결제 성공 URL의 보호자 전화번호

- **리팩토링 3단계 본편 1차: `googleCalendarSync.ts` 나누기 (2026-11-27, 브랜치 `refactor/split-google-calendar-sync` → `main` 병합, 운영 배포 완료 `dpl_8PkGtcpTL5QnSXRhvkbPk2qHxqmj`(1~2차)·`dpl_2tAtf3Z1HoZkcp5B2j9Wj13SjENZ`(3차), 연습용 모드 브라우저 확인 완료: 시간표 변경 18시→19시 반영, 동기화 흐름이 토큰 없음 오류를 정상 기록, 콘솔 오류 0건)**:
  - 2,119줄 → `googleCalendarSync.ts`(동기화 흐름, 955줄) + `googleCalendarCore.ts`(순수 계산, 486줄) + `googleCalendarApi.ts`(구글 요청·캐시·재인증, 772줄). 코드는 그대로 옮기기만 했고, 기존 export 이름 유지
  - `googleCalendarCore.ts`는 저장소·화면 코드를 못 부르도록 ESLint 가드, 동작 고정 테스트 10개 추가
  - 2차: `runSync` 대상 고르기 계산을 이름 붙은 순수 함수로 분리(`selectSyncTargets` 등, 573→517줄), 테스트 +5, 브라우저 확인(시간표 20시 반영·대상 선별 정상)
  - 3차: `runSync` 안의 `syncSingleTarget`(회차 1개 캘린더 반영, 약 360줄)을 `googleCalendarSyncTarget.ts`로 분리. 바깥 변수 대신 `SyncTargetContext`로 재료를 받고, 결과는 `SessionPatch | null`로 돌려줌(본문은 `push`→`return`, `args`→`ctx`만 바뀐 그대로 옮기기, 원본과 기계적 diff로 확인). `googleCalendarSync.ts` 936→579줄. 구글 API를 가짜로 바꾼 동작 고정 테스트 9개 추가(담당자 확인·pending·잘못된 소유자 정리·직행 PATCH·신규 생성+영구 Meet 공유·404 복구·오류 기록). 운영 배포 완료(`dpl_2tAtf3Z1HoZkcp5B2j9Wj13SjENZ`), 로그인 후 브라우저 확인은 아직 안 함
  - **24개 파일 137개 테스트 통과**, lint 0건, 프로덕션 빌드 정상
- **리팩토링 3단계 사전 정리: 저장소 ↔ 구글 캘린더 결합 분리 (2026-11-27, 브랜치 `refactor/decouple-calendar-from-storage` → `main` 병합, 운영 배포 완료 `dpl_4Ua4NHmYtxZgmrXq3EUKUx1jtN7C`)**:
  - `saveSessions`/`saveStudents`/`saveTeachers`는 저장만 담당(캘린더 호출 제거). 캘린더까지 필요한 곳은 `saveSessionsAndSyncCalendar`, `saveStudentsAndResyncCalendar`, `saveTeachersAndResyncCalendar` 등을 명시적으로 호출
  - 캘린더/Meet 재동기화 함수 8종 `lib/integrations/sessionCalendarActions.ts`로 이동, 명단 저장+재동기화 래퍼 `lib/integrations/rosterCalendarActions.ts` 신설, `suppressCalendarSync` 옵션 제거
  - ESLint 가드: `lib/storage`에서 `lib/integrations`·`lib/ui` import 금지
  - 50ms 단기 캐시 무효화: 저장소 키가 다른 경로로 바뀌면 `loadSessions`/`loadStudents` 캐시 즉시 폐기 (`watchBrowserStorageKey`)
  - 미사용 저장 함수 13종 삭제 (`upsertStudent`는 미병합 브랜치 `codex/session-prev-next-buttons` 사용으로 유지)
  - 연습용 모드(`npm run dev:isolated`) 브라우저 확인: 관리자 로그인, 선생님·학생 생성/수정, 시간표 변경, 회차 상세 화면 정상·콘솔 오류 0건
  - **22개 파일 113개 테스트 통과**, lint 0건, 프로덕션 빌드 정상
- **동기화 데이터 보호 및 401/403 정밀 분리 보완 패치 운영 배포 완료 (2026-11-25, 커밋 `af8c76e`)**:
  - `app/api/snapshot/route.ts`: 권한/금지 키 거절(`unauthorized_*`, `server_blocked_mass_deletion`)은 `403 forbidden`, 로그인/토큰 만료(`unauthorized`)는 `401 unauthorized`로 응답 분리
  - `lib/storage/sharedSnapshot.ts` · `lib/ui/common/SharedSnapshotAgent.tsx`: `403`만 큐 폐기(`drop`), `401`은 `forceRefreshAuthSession()` 토큰 갱신 후 1회 재시도, 일시 장애 3회 초과 시 큐를 버리지 않고 일시정지(`pause`) 보관 후 탭 복귀·온라인 복귀·인증 변경·새 입력 시 안전 재개, 학생 계정의 금지 키(`mk3:lectureTree`, `mk3:driveRootId`, 타 학생 키) 사전 큐잉 차단
  - `lib/ui/session/SessionClientCore.tsx` · `SessionTopBarCore.tsx` · `StudentHubCore.tsx`: `TUTORWEB_EVENTS.sessionProgressUpdated` 발행/구독 연결로 중복 POST 없이 진도 초기화·동기화 시 상단 바/허브 진도율 즉시 갱신
  - `lib/storage/lectures.ts`: 미사용 레거시 쓰기 함수(`getSessionItemsDefault`/`getSessionItemsMock`) 삭제
- **Vercel Fast Origin Transfer 9.45GB(Incoming 92.2%) 무한 폭주 긴급 차단 패치 운영 배포 완료 (2026-11-25, 커밋 `792bb69`)**:
  - `lib/storage/lectures.ts`: `normalizeAnyTree`가 `root.createdAt`을 매번 `nowIso()`로 덮어쓰던 버그 수정 및 읽기 함수 `loadLectureTree()`에서 `persistTree` 대신 `browserStorage.setItemSilent`만 사용하도록 차단(학생 화면 진입 시 `mk3:lectureTree` 원격 POST 유발 원천 제거)
  - `lib/storage/sharedSnapshot.ts` · `lib/ui/common/SharedSnapshotAgent.tsx`: `400/401/403` 영구 거절 응답에 `nonRetryable: true`를 부여해 즉시 재시도 중단, 일시 오류도 최대 3회 백오프(`3s → 10s → 30s`)로 상한 고정(기존 1.5초 무한 재전송 폭주 영구 봉쇄)
  - `lib/ui/session/SessionClientCore.tsx`: 서버 수신 직후(`247~256행`) 및 `resetProgress` 저장 직후(`377행`)의 `setItem`을 `setItemSilent`로 교체해 메아리 POST 제거
  - 회귀 방지 테스트 4건 신설(`lib/storage/incomingTrafficGuard.test.ts`, 총 **20개 파일 99개 테스트 100% 통과**)
- **리팩토링 1~2단계(대청소·문서 슬림화·계층 정리) 운영 배포 완료 (2026-11-22, 되돌리기 태그 `pre-refactor` = `b9cfc34`)**:
  - **1단계 (`f235705`, `6e38dcd`)**: 미사용 파일 7개 및 임시 스크립트/로그(`refactor.py`, `fix.py`, `dev.log`) 제거, `.gitignore`에 `*.log` 추가, `docs/project-status-latest.md` 과거 이력 무손실 아카이브 이관(`59.6KB → 5.0KB`), `AGENTS.md`·`technical-debt-and-solutions.md` 정합성 정비
  - **2-a단계 (`f2e2a95`, `7d6b13a`, `1a5d59a`)**: 공용 키 규칙 `lib/shared/sharedStateKeys.ts` 이동, `sessionCardFactory.ts` 순수 계산 4개 `lib/factories/sessionScheduleResolver.ts` 분리, `format.ts`·`ddayMeta.ts` `lib/factories/` 이동
  - **2-b단계 (`314099f`, `fac07f5`, `314256f`, `b9bc525`)**: `SessionMeta`·`SessionMetaStatus` `lib/types/index.ts` 이동(혼동용 `SessionState` alias 제거), 동작 고정 테스트 +20개 보강(`75 → 95개`), 순수 계산 엔진 `lib/factories/sessionEffectiveCore.ts`·`sessionDisplaySync.ts` 및 저장소 어댑터 `lib/storage/sessionMeta.ts` 분리, `sessionFactories.ts` 순수화, `eslint.config.mjs` `no-restricted-imports` 자동 가드레일 탑재 및 실효성 검증 완료
  - **최종 감사 달성**: 비-UI → `lib/ui` **0건**, `lib/server` → `lib/storage`/`lib/ui` **0건**, 3단계(대형 파일 분해)는 의도적으로 보류하여 이번 범위 종료
- **시간표 조정 고속화 & 캘린더 병렬 동기화 완료 (2026-11-21 운영 반영)**:
  - 개별/일괄 시간표 조정 `POST /api/snapshot` 1회 부분 병합(`merge`) 통합, 실패 시 로컬 롤백, `browserStorage.setItemSilent` 중복 전송 차단
  - 구글 캘린더 동시 3병렬 실행, 429/403 자동 백오프 재시도, `eventId` 확정 회차 직행 `PATCH`, 수업 길이 단독 변경(`overrideDurationMin`) 동기화 지원
- **결제·보안·성능 기반 안정화 완료 (2026-10 ~ 2026-11 운영 반영)**:
  - 토스페이먼츠 라이브 키/시크릿 환경변수 분리, 금액·주문번호 서버 검증, 결제 장부(`payment_orders`) 이중 기록 및 관리자 조회 API(`/api/payments/orders`) 구축
  - 브라우저 Direct Supabase REST Fallback 제거, 학생/선생님 `stateKv` 권한 분리, `patch_snapshot_state_kv` 원자적 병합, 정규화 테이블(`students`, `sessions`) 듀얼라이트 및 `NEXT_PUBLIC_READ_FROM_NORMALIZED` 읽기 스위치 탑재
  - Vercel 서울 리전(`icn1`) 고정, API별 `select` 컬럼 경량화, 스냅샷 SHA-256 다이제스트 정밀화 및 `tmain` 학습 진도율 실시간 반영
- **품질 안전망**: 단위 테스트 **20개 파일 101개 100% 통과**, ESLint 오류 0건(계층 가드 포함), Next.js 프로덕션 빌드(`next build --webpack`) 정상

---

## 현재 고정 운영 정책

1. **관리자 정책**
   - 마스터 관리자 이메일 기본값: `rapah0310@gmail.com` (`NEXT_PUBLIC_ADMIN_EMAILS` / `ADMIN_EMAILS` 환경변수 병합 확장 지원)
2. **데이터 원본 정책**
   - 학생/선생님/회차 읽기·저장은 서버(Supabase) 단일 원본 기준, 핵심 저장 경로는 `serverRequired: true` 적용
   - 스냅샷(`app_state_snapshots`) 저장 시 정규화 테이블(`students`, `sessions`) 변경분 듀얼라이트 병행 중
3. **회차·캘린더·Meet 동기화 정책**
   - 회차/Meet 생성 소유자는 항상 **담당 선생님 이메일** 기준 (관리자 비소유자 변경 시 `pending` 재동기화 요청)
   - 학생 1인당 영구 Google Meet 링크(`permanentMeetUrl`) 단일 통일, Google API `401` 시 `next` 경로 유지 자동 재인증 및 루프 방지 가드 유지
4. **환불 운영 정책**
   - `/programs`, `/policy`에 법적 표준 환불 규정 고지 유지, 실제 환불 정산은 관리자 콘솔 + 학생 `종료(ended)` 수동 운영

---

## 최근 주요 배포 이력 (최신 5건)

- `2026-11-27 20:30` — 프로덕션 배포 `dpl_GNE1ySyqmK1ycZDQdmbvq72nSvY8` (커밋 `ecaed9c`, `git push origin main` 자동 배포, 운영 주소: `https://okjinsoowebapp.vercel.app`, 보안 점검 Must fix: `/api/snapshot` guest 403·stateKey 필터, proxy 역할 대체 조회 service role, 결제 새로고침 장부 훼손 수정, DB 잠금 SQL 015 추가(Supabase 미적용), 단위 테스트 139개 통과)
- `2026-11-27 16:22` — 프로덕션 배포 `dpl_2tAtf3Z1HoZkcp5B2j9Wj13SjENZ` (커밋 `3a69afa`, `git push origin main` 자동 배포, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-f16eip7u4-okjinsoos-projects.vercel.app`, 리팩토링 3단계 3차: `syncSingleTarget`을 `googleCalendarSyncTarget.ts`로 분리, 동작 고정 테스트 +9, 단위 테스트 137개 통과)
- `2026-11-27 15:58` — 프로덕션 배포 `dpl_8PkGtcpTL5QnSXRhvkbPk2qHxqmj` (커밋 `f713313`, `git push origin main` 자동 배포, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-l84d9vx8d-okjinsoos-projects.vercel.app`, 리팩토링 3단계 1차: `googleCalendarSync.ts` → `googleCalendarCore`·`googleCalendarApi` 분리, `runSync` 대상 고르기 순수 함수 분리, 단위 테스트 128개 통과)
- `2026-11-27 02:52` — 프로덕션 배포 `dpl_4Ua4NHmYtxZgmrXq3EUKUx1jtN7C` (커밋 `188e326`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-pvpxowshw-okjinsoos-projects.vercel.app`, 저장소↔구글 캘린더 결합 분리(`sessionCalendarActions`·`rosterCalendarActions`, ESLint 가드), 50ms 캐시 무효화, 미사용 저장 함수 13종 삭제, 연습용 모드 브라우저 확인, 단위 테스트 113개 통과)
- `2026-11-25 19:22` — 프로덕션 배포 `dpl_ENszGc6ukVfQipcaD24TLstUZbs5` (커밋 `af8c76e`, 운영 주소: `https://okjinsoowebapp.vercel.app`, 배포 URL: `https://okjinsoowebapp-klip8rnjz-okjinsoos-projects.vercel.app`, 401/403 응답 분리, 401 토큰 갱신 1회 재시도 및 3회 초과 시 큐 보존 일시정지, 학생 금지 키 사전 차단, `sessionProgressUpdated` 상단 바·허브 즉시 갱신 연결, `getSessionItemsDefault` 죽은 코드 삭제, 단위 테스트 101개 통과)

> 2026-03 ~ 2026-11 전체 상세 패치·배포 로그는 [`docs/project-status-archive.md`](file:///Users/okjinsoo/Project/TutorWEB/v1/docs/project-status-archive.md)에 보관되어 있습니다.

---

## 품질/배포 체크 표준

배포 또는 리팩토링 단계 완료 전 필수 순서:
1. `npm run lint`
2. `npm run test:run`
3. `npm run build`

## 문서 운영 규칙

- 이 문서는 **현재 판단용 최신 요약**만 가볍게 유지합니다.
- 오래된 상세 패치·배포 이력은 `docs/project-status-archive.md`로 이관해 누적합니다.
- 큰 패치/배포 후 즉시 `기준 시각`, `최신 운영 배포본(시각/주소/배포 ID)`, `최근 주요 배포 이력`을 갱신합니다.
