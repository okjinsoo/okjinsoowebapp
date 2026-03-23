# TutorWEB API 권한표 (실구현 기준)

작성일: 2026-03-21  
기준 코드: `app/api/**/route.ts`, `lib/server/supabaseSnapshotApi.ts`

이 문서는 "현재 실제 동작"을 기준으로 작성했습니다.  
즉, 과거 설계안이 아니라 **지금 코드가 어떻게 응답하는지**를 정리한 표입니다.

---

## 0) 공통 응답 규칙

- `200`: 정상 처리
- `400`: 요청 바디 형식 오류(예: JSON 깨짐, 필수 필드 누락)
- `401`: 인증 실패 또는 권한 없음(일부 엔드포인트는 403 대신 401 사용)
- `403`: 로그인은 되었지만 해당 학생 데이터 소유권 없음
- `500`: 서버 처리 실패

주의:
- `/api/snapshot POST`는 내부 에러 문자열이 `unauthorized`를 포함하면 `401`, 아니면 `500`으로 응답합니다.
- 그래서 일부 "권한 거절"도 구현상 `403`이 아닌 `401`로 내려올 수 있습니다.

---

## 1) 인증/세션 브리지

| Method | Endpoint | 인증 필요 | 권한 규칙 | 주요 응답 |
|---|---|---|---|---|
| POST | `/api/auth/bridge` | 없음(동일 출처 호출 전제) | `accessToken`이 바디에 있어야 함. 서버가 서명된 `httpOnly` 쿠키 발급 | `200`, `400(access_token_missing/invalid_json)`, `500(bridge_secret_missing)` |
| DELETE | `/api/auth/bridge` | 없음(동일 출처 호출 전제) | 브리지 쿠키 삭제 | `200` |
| GET | `/api/auth/me` | 필요 | `resolveViewerContext` 성공 시 본인 정보 반환 | `200`, `401`, `500` |

---

## 2) 스냅샷 API

| Method | Endpoint | 인증 필요 | 권한 규칙 | 주요 응답 |
|---|---|---|---|---|
| GET | `/api/snapshot` | 필요 | 학생은 본인 `students/sessions`만 필터링되어 반환, 관리자/선생님은 역할 범위 데이터 반환 | `200`, `401`, `500` |
| POST | `/api/snapshot` | 필요 | 아래 "세부 권한" 참고 | `200`, `401`, `500` |

### `/api/snapshot POST` 세부 권한

- `admin`
  - `teachers/students/sessions/stateKv` 수정 가능
- `teacher`
  - `teachers` 수정 불가
  - `students/sessions/stateKv`는 서버 검증 통과 시 수정 가능
- `student`
  - 본인 학생 레코드 1건만 수정 가능
  - `planCount/paymentHistory` 수정 시도 차단
  - `sessions/teachers/stateKv` 수정 차단

추가 서버 가드:
- 대량 삭제 의심 패치 차단 로직 존재 (`server_blocked_mass_deletion`)

---

## 3) 학생/선생 조회 API

| Method | Endpoint | 인증 필요 | 소유권/필터 규칙 | 주요 응답 |
|---|---|---|---|---|
| GET | `/api/students` | 필요 | `admin`: 전체, `teacher`: 본인 담당만, `student`: 본인만 | `200`, `401`, `500` |
| GET | `/api/teachers` | 필요 | `admin`: 전체, `teacher`: 본인만, `student`: 본인 담당 선생님만 | `200`, `401`, `500` |
| GET | `/api/students/:id/sessions` | 필요 | `canReadStudent` 통과 시만 조회 (`admin` 전체, `teacher` 담당 학생, `student` 본인) | `200`, `401`, `403`, `500` |
| GET | `/api/students/:id/consultations` | 필요 | `canReadStudent` 통과 시만 조회 (`admin` 전체, `teacher` 담당 학생, `student` 본인) | `200`, `401`, `403`, `500` |

---

## 4) 운영 백업 API

| Method | Endpoint | 인증 필요 | 권한 규칙 | 주요 응답 |
|---|---|---|---|---|
| GET | `/api/ops/backup/daily` | 필요 | `Authorization: Bearer <CRON_BACKUP_SECRET>` 또는 관리자 세션 | `200`, `401`, `500` |
| POST | `/api/ops/backup/daily` | 필요 | GET과 동일 (`POST`는 내부적으로 GET 호출) | `200`, `401`, `500` |

---

## 5) 현재 없는 엔드포인트 (중요)

아래 API는 현재 코드에 없습니다.

- `/api/auth/login`
- `/api/auth/logout`
- `/api/students/:id` (GET/PATCH/DELETE)
- `/api/teachers/:id` (GET/PATCH)
- `/api/teacher-students/*`
- `/api/students/:id/payments*`
- `/api/admin/*`

즉, 이전 설계 문서에서만 보이고 실제 구현은 아직 없는 상태입니다.

---

## 6) 운영 체크리스트

- [ ] 새 API를 추가할 때 이 문서를 같은 날 업데이트했는가
- [ ] `401/403/500` 응답코드가 문서와 일치하는가
- [ ] 소유권 함수(`canReadStudent` 등) 변경 시 표를 같이 수정했는가
