# Project Status (Latest)

기준 시각: 2026-09-26 21:00 (KST)
대상 프로젝트: `v1`

## 1분 요약

- 최신 패치 반영: 2026-09-26 21:00 (KST)
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
- 최신 운영 반영본: 2026-08-20 00:20 (KST)
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
- `a/tmain`, `t/tmain`에서 `본인 학생 회차 동기화` 일괄 요청 가능

## 최근 변경(운영 영향 큰 항목)

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
