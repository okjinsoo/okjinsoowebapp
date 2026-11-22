# Project Status (Latest)

기준 시각: 2026-11-22 19:55 (KST)  
대상 프로젝트: `v1`  
운영 주소: `https://okjinsoowebapp.vercel.app`  
최신 운영 배포본: `2026-11-21 20:03 (KST)` (`dpl_GK3TN1ryTRMLiU5EdjHANHPaNF7s`, 커밋 `0aefd62`)

---

## 1분 요약 (현재 확정 상태)

- **리팩토링 1~2단계(대청소·문서 슬림화·계층 정리) 로컬 완료 (2026-11-22, 되돌리기 태그 `pre-refactor` = `b9cfc34`)**:
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
- **품질 안전망**: 단위 테스트 **19개 파일 95개 100% 통과**, ESLint 오류 0건(계층 가드 포함), Next.js 프로덕션 빌드(`next build --webpack`) 정상

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

- `2026-11-21 20:03` — 프로덕션 배포 `dpl_GK3TN1ryTRMLiU5EdjHANHPaNF7s` (커밋 `0aefd62`, 시간표 조정 1회 부분 병합 고속화, 실패 롤백, 변경분 듀얼라이트, 구글 캘린더 3병렬+429 백오프)
- `2026-11-20 16:28` — 프로덕션 재배포 `57fs8sCNsPwscT4TuBveZNkH4x9R` (Vercel Production 토스페이먼츠 환경변수 등록 및 `/api/payments/confirm` 정상화)
- `2026-11-14 00:20` — 프로덕션 배포 커밋 `58f2df4` (토스 시크릿키 격리·금액 검증, `stateKv` 권한 분리·Direct Fallback 제거, `patch_snapshot_state_kv` 원자적 병합, `payment_orders` 결제 장부 구축)
- `2026-11-02 17:44` — 프로덕션 배포 커밋 `499a10e` (`tmain` 학습 진도율 실시간 동기화: SHA-256 다이제스트 정밀화, `sessionProgressUpdated` 이벤트 연동)
- `2026-10-29 19:55` — 프로덕션 배포 커밋 `f5fe77c` (서울 리전 `icn1` 고정, API `select` 경량화, Bearer 토큰 직접 동봉, 로그인 강제 대기 타이머 제거)

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
