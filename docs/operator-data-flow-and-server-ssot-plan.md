# 옥진수학 운영자용 데이터 흐름도 + 서버 단일원천(SSOT) 전환 계획

작성일: 2026-02-28

이 문서는 운영자가 보기 쉽게,
1) 현재 데이터가 어떻게 흐르는지
2) 왜 아직 완전한 서버 단일원천이 아닌지
3) 완전한 서버 단일원천으로 가려면 무엇을 해야 하는지
를 한 번에 정리한 문서입니다.

---

## 1. 현재 구조 한눈에 보기

현재 구조는 `브라우저 저장소 우선 + Supabase 공유 스냅샷 동기화` 방식입니다.

즉,
- 먼저 브라우저(sessionStorage)에 저장하고
- 같은 화면은 즉시 다시 계산해서 반영하고
- 그 뒤 Shared Snapshot Agent가 Supabase `app_state_snapshots`로 동기화합니다.

쉽게 말하면,
- 교실에서 먼저 공책에 적고
- 나중에 공용 서랍장(DB)에 복사해 넣는 구조입니다.

### 현재 구조 요약

| 항목 | 현재 1차 저장소 | 공통 계산/규칙 | DB 반영 방식 |
| --- | --- | --- | --- |
| 성취도 | `mk3:{token}:session:{n}:leafIds`, `progressByLeafId` | `sessionProgressFactory` | shared snapshot `state_kv` |
| 출결/변경/이월 | `tutorweb_metaMap_v1:{token}` | `sessionEffective` | shared snapshot `state_kv` |
| 상담 | `tutorweb_consultations_v1` | `consultationMap` | shared snapshot `state_kv` |
| 환불/결제 | 학생 객체(`students`) 내부 | `lessonStatusFactory` | shared snapshot `students` |
| 회차 목록 | `tutorweb_sessions_v1` | `computeEffectiveISO` 등과 조합 | shared snapshot `sessions` |

---

## 2. 운영자용 데이터 흐름도

### 2-1. 성취도

1. 회차 상세에서 강의를 배치합니다.
2. 회차 상세에서 필기/풀이 제출 여부를 체크합니다.
3. `leafIds`, `progressByLeafId`가 브라우저 저장소에 저장됩니다.
4. 저장 이벤트가 발생합니다.
5. `sessionProgressFactory`가 `done / total / percent`를 계산합니다.
6. 아래 화면들이 같은 계산값을 다시 그립니다.
   - 회차 상세 상단
   - 학생 홈의 예정 수업
   - 학생 수업 목록
   - 선생님 오늘의 수업
7. Shared Snapshot Agent가 이 값을 DB(`app_state_snapshots.state_kv`)로 올립니다.

### 2-2. 출결 / 변경 / 이월

1. 출석 / 결석 / 조정 버튼을 누릅니다.
2. `upsertMeta(token, index, patch)`가 실행됩니다.
3. `tutorweb_metaMap_v1:{token}` 저장소가 갱신됩니다.
4. `metaMapUpdated` 이벤트가 발생합니다.
5. 모든 관련 화면이 다시 계산합니다.
   - 출석/결석/예정 상태
   - 변경/이월 배지
   - 최종 수업 날짜/시간
6. Shared Snapshot Agent가 DB(`state_kv`)로 동기화합니다.

### 2-3. 상담

1. 상담 모달에서 내용을 저장합니다.
2. 학생별 상담 목록이 `tutorweb_consultations_v1`에 저장됩니다.
3. `consultationsUpdated` 이벤트가 발생합니다.
4. `buildConsultationMap`이 상담을 회차별로 다시 연결합니다.
5. 학생/선생님/관리자 화면의 상담 배지가 갱신됩니다.
6. Shared Snapshot Agent가 DB(`state_kv`)로 동기화합니다.

### 2-4. 환불 / 결제

1. 환불 요청 또는 환불 완료를 입력합니다.
2. `computeRefundRatio`가 환불 비율을 계산합니다.
3. 학생 객체 내부의 결제 기록(`paymentHistory`, `baseRefund...`)이 수정됩니다.
4. `upsertStudent`로 학생 저장소가 갱신됩니다.
5. 필요하면 `saveSessions`로 회차 수도 같이 줄이거나 정리합니다.
6. 학생/관리자 화면에서 결제/환불 배지가 다시 계산됩니다.
7. shared snapshot의 `students`, `sessions`로 DB에 반영됩니다.

---

## 3. 현재 구조의 장점 / 한계

### 장점

- 화면 반응이 빠릅니다.
- 같은 탭에서는 즉시 반영됩니다.
- 이미 중앙화된 계산 함수가 있어서 화면 간 불일치가 많이 줄었습니다.

### 한계

- 브라우저 저장소가 먼저이기 때문에, 진짜 원본이 브라우저 쪽입니다.
- 네트워크가 늦거나 동기화가 실패하면, 다른 기기/다른 로그인에서 늦게 보일 수 있습니다.
- 권한 검증도 화면 코드에 남아 있는 부분이 많아, 서버 강제가 아닙니다.
- 결국 “완전한 서버 단일원천”은 아직 아닙니다.

즉,
- 지금은 `공책이 원본, 서랍장이 복사본`에 가깝습니다.
- 목표는 `서랍장이 원본, 공책은 잠깐 보는 종이`로 바꾸는 것입니다.

---

## 4. 완전한 서버 단일원천(SSOT)이란?

완전한 서버 단일원천은 아래 뜻입니다.

- 학생/선생님/회차/상담/결제/환불/성취도 원본이 모두 서버 DB에 있습니다.
- 화면은 DB를 직접 읽습니다.
- 변경도 DB에 직접 씁니다.
- 브라우저 저장소는 로그인 캐시나 임시 입력 정도만 맡습니다.
- 권한도 서버에서 강제로 막습니다.

쉽게 말하면,
- 모든 선생님과 운영자가 **같은 공식 장부 한 권**을 보는 상태입니다.

---

## 5. 이 프로젝트는 서버 단일원천으로 갈 준비가 되어 있나?

`예, 뼈대는 이미 있습니다.`

### 이미 있는 것

1. DB 스키마 초안이 이미 있음
- `db/combined/001_008_all_in_one.sql`
- 여기 안에 아래 테이블 초안이 있습니다.
  - `teachers`
  - `students`
  - `teacher_students`
  - `sessions`
  - `session_meta`
  - `consultations`
  - `payments`
  - `role_bindings`
  - `app_state_snapshots`

2. API 전환 설계 문서가 이미 있음
- `docs/api-route-migration-map.md`
- `docs/api-auth-matrix.md`

3. 권한 기준 문서가 이미 있음
- `docs/deploy-schema-template.md`
- `docs/vercel-postgres-session-checklist.md`

즉,
- “무에서 새로 설계”가 아니라
- “지금 로컬 저장소 코드를 서버 API로 옮기는 작업”입니다.

---

## 6. 서버 단일원천 전환 목표 구조

전환 후에는 아래처럼 바뀌어야 합니다.

### 목표 구조

1. 화면은 브라우저 저장소 대신 `/api/...`를 호출합니다.
2. API Route(서버)가 권한을 검사합니다.
3. API Route가 Supabase(Postgres)에 직접 읽고 씁니다.
4. DB가 진짜 원본이 됩니다.
5. 화면은 응답값으로 다시 그립니다.
6. 브라우저 저장소는 선택 상태, 임시 draft 정도만 맡습니다.

### 목표 읽기 흐름

`화면 -> API Route -> Supabase 테이블 -> API 응답 -> 화면 렌더`

### 목표 쓰기 흐름

`버튼 클릭 -> API Route -> DB UPDATE/INSERT -> 결과 반환 -> 화면 갱신`

---

## 7. 어떤 데이터부터 서버 단일원천으로 옮겨야 하나?

우선순위는 아래 순서가 가장 안전합니다.

### 1순위: 읽기 API

먼저 읽기부터 서버화합니다.

- `GET /api/students`
- `GET /api/teachers`
- `GET /api/students/:id/sessions`
- `GET /api/students/:id/consultations`

이 단계가 되면,
- 화면이 로컬 저장소 대신 서버 데이터로 그려집니다.
- “보는 데이터”부터 원본이 서버로 바뀝니다.

### 2순위: 출결 / 조정 / 상담 쓰기 API

그다음 많이 쓰는 수정 기능을 서버화합니다.

- `PATCH /api/students/:id/sessions/:index/meta`
- `POST /api/students/:id/consultations`
- `PATCH /api/students/:id/consultations/:consultId`
- `DELETE /api/students/:id/consultations/:consultId`

이 단계가 되면,
- 출결/변경/상담은 완전히 서버 장부에 직접 쓰게 됩니다.

### 3순위: 학생 / 선생 / 담당관계 API

- `POST /api/students`
- `PATCH /api/students/:id`
- `POST /api/teachers`
- `PATCH /api/teachers/:id`
- `POST /api/teacher-students`
- `DELETE /api/teacher-students/:teacherId/:studentId`

이 단계가 되면,
- 명단/담당관계도 서버가 원본이 됩니다.

### 4순위: 결제 / 환불 API

- `POST /api/students/:id/payments`
- `PATCH /api/students/:id/payments/:paymentId`
- `POST /api/students/:id/payments/:paymentId/refund`

이 단계가 되면,
- 결제/환불 계산이 서버 장부 기준으로 돌아갑니다.

### 5순위: 성취도 / 강의배치 API

- `PATCH /api/students/:id/sessions/:index/progress`
- `PATCH /api/students/:id/sessions/:index/lectures`

이 단계가 되면,
- 성취도와 강의 배치까지 완전히 서버 원본이 됩니다.

---

## 8. 전환 시 꼭 바꿔야 하는 코드 포인트

### 브라우저 저장소 기반 함수들

아래 계열 함수는 결국 서버 호출로 바뀌어야 합니다.

- `loadStudents`, `saveStudents`, `upsertStudent`
- `loadTeachers`, `saveTeachers`, `upsertTeacher`
- `loadSessions`, `saveSessions`, `upsertSession`
- `loadConsultationsByStudent`, `saveConsultationsByStudent`
- `readMetaMap`, `upsertMeta`
- `readSessionLeafIds`, `readSessionProgressByLeafId`

### 유지해도 되는 것

아래는 서버 원본 구조가 되어도 계속 쓸 수 있습니다.

- `computeEffectiveISO`
- `buildBadges`
- `buildConsultationMap`
- `computeRefundRatio`
- `buildDisplayRecords`
- `calculateSessionProgressSummary`

즉,
- **저장 함수는 서버화**
- **계산 함수는 재사용**
이 원칙이 좋습니다.

---

## 9. 전환 완료 판단 기준

아래 조건을 만족하면 “완전한 서버 단일원천”이라고 볼 수 있습니다.

1. 새로고침해도 데이터가 브라우저 저장소 없이 서버에서 복구됨
2. 다른 기기 로그인에서도 같은 값이 즉시 보임
3. 권한이 없는 사용자는 API 단계에서 차단됨
4. `app_state_snapshots`는 백업/호환용이거나 제거됨
5. 화면 코드가 `loadStudents()` 같은 로컬 함수 대신 서버 fetch를 사용함
6. 성취도/출결/상담/환불 변경이 모두 API를 통해 DB에 바로 저장됨

---

## 10. 운영자 결론

현재 시스템은 이미 많이 정리됐지만,
아직은 `로컬 우선 + DB 동기화` 구조입니다.

운영 관점에서 진짜 안정적인 목표는 아래입니다.

- DB를 유일한 원본으로 만든다.
- 화면은 그 DB를 읽기만 한다.
- 수정도 서버 API를 통해서만 한다.
- 브라우저 저장소는 임시값만 맡긴다.

이 프로젝트는 그 단계로 갈 설계 자료와 DB 초안이 이미 있으므로,
이제 필요한 것은 “새로 설계”가 아니라 “순서대로 갈아타기”입니다.

---

## 11. 추천 실행 순서 (실무 기준)

1. 읽기 API부터 서버화
2. 출결/상담 쓰기 API 서버화
3. 학생/선생/담당관계 API 서버화
4. 결제/환불 API 서버화
5. 성취도/강의배치 API 서버화
6. 마지막에 shared snapshot 의존성 제거

이 순서가 가장 덜 위험합니다.

