# TutorWEB API 권한표 템플릿 (v1)

작성일: 2026-02-05  
원칙: `deny by default` (표에 없는 것은 기본 403)

## 응답코드 규칙
- `401`: 로그인 안 됨(세션 없음/만료)
- `403`: 로그인은 됐지만 권한 없음
- `404`: 리소스 없음(또는 존재 은닉 정책)

---

## 1) 인증

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| POST | `/api/auth/login` | 허용 | 허용 | 허용 | 계정+비번 확인 | `AUTH_LOGIN` |
| POST | `/api/auth/logout` | 허용 | 허용 | 허용 | 본인 세션만 | `AUTH_LOGOUT` |
| GET | `/api/auth/me` | 허용 | 허용 | 허용 | 본인 | 없음 |

---

## 2) 학생

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| GET | `/api/students` | 허용 | 허용(담당만) | 금지 | t는 `teacher_students` 관계 필수 | 없음 |
| POST | `/api/students` | 허용 | 금지 | 금지 | a만 생성 | `STUDENT_CREATE` |
| GET | `/api/students/:id` | 허용 | 허용(담당만) | 허용(본인만) | t=담당, s=본인 | 없음 |
| PATCH | `/api/students/:id` | 허용 | 제한허용(담당+허용필드) | 금지 | 필드 권한 분리 필요 | `STUDENT_UPDATE` |
| DELETE(soft) | `/api/students/:id` | 허용 | 금지 | 금지 | hard delete 금지 | `STUDENT_DISABLE` |

---

## 3) 선생

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| GET | `/api/teachers` | 허용 | 금지/제한 | 금지 | 운영 정책에 맞게 | 없음 |
| POST | `/api/teachers` | 허용 | 금지 | 금지 | a만 | `TEACHER_CREATE` |
| GET | `/api/teachers/:id` | 허용 | 허용(본인만) | 금지 | t는 자기 id만 | 없음 |
| PATCH | `/api/teachers/:id` | 허용 | 허용(본인 제한필드) | 금지 | 필드 권한 분리 | `TEACHER_UPDATE` |

---

## 4) 담당 관계(teacher_students)

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| POST | `/api/teacher-students` | 허용 | 금지 | 금지 | 중복 금지(`unique`) | `TEACHER_STUDENT_ATTACH` |
| DELETE(soft) | `/api/teacher-students/:teacherId/:studentId` | 허용 | 금지 | 금지 | a만 | `TEACHER_STUDENT_DETACH` |

---

## 5) 회차/회차메타

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| GET | `/api/students/:id/sessions` | 허용 | 허용(담당만) | 허용(본인만) | 역할+소유권 필수 | 없음 |
| PATCH | `/api/students/:id/sessions/:index/meta` | 허용 | 허용(담당만) | 금지 | 출결/조정은 a,t만 | `SESSION_META_UPDATE` |
| POST | `/api/students/:id/sessions/rebuild` | 허용 | 제한허용 | 금지 | 정책 필요(보통 a) | `SESSION_REBUILD` |

---

## 6) 상담

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| GET | `/api/students/:id/consultations` | 허용 | 허용(담당만) | 허용(본인 정책에 따라 읽기 제한) | 역할+소유권 | 없음 |
| POST | `/api/students/:id/consultations` | 허용 | 허용(담당만) | 금지 | 목적별 필드 검증 | `CONSULT_CREATE` |
| PATCH | `/api/students/:id/consultations/:consultId` | 허용 | 제한허용 | 금지 | `finalResult`류는 a만 | `CONSULT_UPDATE` |
| DELETE | `/api/students/:id/consultations/:consultId` | 허용(정책) | 제한/금지 | 금지 | 삭제 정책 확정 필요 | `CONSULT_DELETE` |

---

## 7) 결제/환불

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| GET | `/api/students/:id/payments` | 허용 | 허용(담당만) | 금지/제한 | 개인정보 정책 반영 | 없음 |
| POST | `/api/students/:id/payments` | 허용 | 제한허용 | 금지 | 결제완료 체크 정책 필요 | `PAYMENT_APPEND` |
| PATCH | `/api/students/:id/payments/:paymentId` | 허용 | 제한허용 | 금지 | 인덱스 재계산 포함 | `PAYMENT_UPDATE` |
| POST | `/api/students/:id/payments/:paymentId/refund` | 허용 | 제한허용(요청만) | 금지 | 완료처리는 a 우선 | `REFUND_UPDATE` |

---

## 8) 관리자 대시보드 집계

| Method | Endpoint | a | t | s | 소유권 규칙 | 감사로그 |
|---|---|---|---|---|---|---|
| GET | `/api/admin/summary` | 허용 | 금지 | 금지 | a만 | 없음 |
| GET | `/api/admin/pause-requests` | 허용 | 금지 | 금지 | a만 | 없음 |
| GET | `/api/admin/extension-needed` | 허용 | 금지 | 금지 | a만 | 없음 |

---

## 9) CSRF 적용 대상(상태 변경 API)
- POST / PATCH / DELETE 전부
- 최소 적용 대상:
  - 상담 생성/수정/삭제
  - 결제 생성/수정/환불 처리
  - 회차 메타 변경(출결/조정/숨김)
  - 학생/선생 수정

---

## 10) 구현 체크
- [ ] 모든 상태변경 API에 `401/403/404` 분리 적용
- [ ] 모든 조회 API에 소유권 조건(DB 관계) 포함
- [ ] 감사로그 action 명세와 실제 코드 1:1 매핑
- [ ] 표에 없는 API는 기본 403

