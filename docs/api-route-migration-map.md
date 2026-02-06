# TutorWEB localStorage → API 전환 매핑표 (v1)

작성일: 2026-02-05  
목적: 지금 화면에서 일어나는 저장/조회 동작을, 배포용 서버 API로 1:1 옮기기 위한 지도

## 0) 이 문서가 하는 일 (쉬운 설명)
- 지금은 각 화면이 `localStorage`에 직접 쓰고 읽습니다.
- 배포 후에는 화면이 직접 장부를 만지면 안 되고, **API 창구**로만 요청해야 안전합니다.
- 그래서 이 문서는 “어떤 버튼 → 어떤 API”로 갈지 고정해 줍니다.

---

## 1) 현재 저장소(클라이언트) 키
- 학생 목록: `tutorweb_students_v1`
- 회차 목록: `tutorweb_sessions_v1`
- 상담 기록: `tutorweb_consultations_v1`
- 선생 목록: `tutorweb_teachers_v1`
- 현재 역할/선택:
  - `tutorweb_current_role_v1`
  - `tutorweb_current_student_token`
  - `tutorweb_current_teacherId_v1`
- 회차 메타맵: `mk3:*`, `tw_session_meta_v4:*`

---

## 2) 화면 동작 → API 매핑

| 화면/버튼 | 현재 구현(로컬) | 전환 API(예정) | 권한 | 감사로그 |
|---|---|---|---|---|
| 로그인(향후) | 역할/학생/선생 선택 local key 저장 | `POST /api/auth/login` | a/t/s | `AUTH_LOGIN` |
| 로그아웃(향후) | local key 정리 | `POST /api/auth/logout` | a/t/s | `AUTH_LOGOUT` |
| 내 정보 확인 | local key 로 현재 사용자 판별 | `GET /api/auth/me` | a/t/s | - |
| 학생 생성(`/a/students/new`, `/t/tmain/new`) | `upsertStudent`, `upsertSession` | `POST /api/students` (+서버에서 초기 회차 생성) | a, t(정책) | `STUDENT_CREATE` + `SESSION_REBUILD` |
| 학생 수정(`/role/smain/edit`) | `upsertStudent`, 재계산 후 `saveSessions` | `PATCH /api/students/:id` | a, t(제한) | `STUDENT_UPDATE` |
| 학생 삭제(`/role/smain/edit`) | `removeStudent`, `removeSessionsByStudentId`, 상담 삭제 | `DELETE /api/students/:id`(soft) | a | `STUDENT_DISABLE` |
| 학생 목록(`/a/students`) | `loadStudents` | `GET /api/students` | a, t(담당만) | - |
| 선생 목록(`/a/teachers`) | `loadTeachers` | `GET /api/teachers` | a | - |
| 선생 생성(`/a/teachers/new`) | `upsertTeacher` | `POST /api/teachers` | a | `TEACHER_CREATE` |
| 선생 수정(`/a/teachers/edit`) | `upsertTeacher` | `PATCH /api/teachers/:id` | a | `TEACHER_UPDATE` |
| 선생 삭제(`/a/teachers`) | `removeTeacher` + 학생 teacherId 해제 | `DELETE /api/teachers/:id`(soft) | a | `TEACHER_DISABLE` |
| 담당관계 설정 | 학생 객체의 `teacherId` 직접 저장 | `POST /api/teacher-students` | a | `TEACHER_STUDENT_ATTACH` |
| 담당관계 해제 | 학생 객체에서 `teacherId` 제거 | `DELETE /api/teacher-students/:teacherId/:studentId` | a | `TEACHER_STUDENT_DETACH` |
| 회차 목록(`/role/smain/session`) | `sessionsByStudent`, `readMetaMap` | `GET /api/students/:id/sessions` | a/t/s(소유권) | - |
| 회차 상세(`/role/smain/session/:index`) | 세션+메타+상담 로컬 조합 | `GET /api/students/:id/sessions/:index` | a/t/s(소유권) | - |
| 출석/결석/조정 | `upsertMeta(token,index,patch)` | `PATCH /api/students/:id/sessions/:index/meta` | a, t | `SESSION_META_UPDATE` |
| 회차 재계산(시간변경/연장/휴회) | `saveSessions` 재생성/숨김 | `POST /api/students/:id/sessions/rebuild` | a(권장), t(정책) | `SESSION_REBUILD` |
| 상담 생성(일반/연장요청/휴회요청) | `saveConsultationsByStudent` | `POST /api/students/:id/consultations` | a, t | `CONSULT_CREATE` |
| 상담 수정 | `saveConsultationsByStudent` | `PATCH /api/students/:id/consultations/:consultId` | a, t(제한) | `CONSULT_UPDATE` |
| 상담 삭제 | `saveConsultationsByStudent`에서 제거 | `DELETE /api/students/:id/consultations/:consultId` | a(권장) | `CONSULT_DELETE` |
| 연장 결제 기록 추가 | 학생 `paymentHistory` append | `POST /api/students/:id/payments` | a, t(정책) | `PAYMENT_APPEND` |
| 결제 기록 수정/삭제 | 학생 `paymentHistory` 재계산 | `PATCH /api/students/:id/payments/:paymentId` / `DELETE ...` | a(권장) | `PAYMENT_UPDATE` |
| 환불 요청/처리 | paymentHistory 환불 필드 업데이트 | `POST /api/students/:id/payments/:paymentId/refund` | 요청:t/a, 완료:a | `REFUND_UPDATE` |

---

## 3) 우선 전환 순서(실행 순서)
1. **인증/세션 API**부터 (login/logout/me)  
2. **읽기 API**부터 (students, teachers, sessions, consultations)  
3. **상태변경 API** (상담/출결/조정/결제/환불)  
4. 화면의 `load*/save*` 직접 호출 제거, API 클라이언트로 교체  

---

## 4) 위험 포인트(필수 체크)
- 화면 필터만으로 권한 처리 금지: API에서 담당관계 DB 검사 필수
- URL query에 token/id 노출 금지: 서버 세션으로 현재 사용자 식별
- 상태변경 API(POST/PATCH/DELETE) CSRF 방어 필수
- `audit_logs`는 append-only 유지(수정/삭제 금지)

