# Vercel + Postgres 세션/쿠키 사고 체크리스트 (v1)

작성일: 2026-02-05  
목적: 배포 후 자주 터지는 로그인/권한/쿠키 사고를 사전에 막기

## 0) 이 체크리스트가 하는 일 (쉬운 설명)
- 웹앱 배포는 “교실 열쇠”를 서버가 관리해야 안전합니다.
- 이 문서는 “열쇠(세션 쿠키)가 안 먹는 문제”를 예방하는 점검표입니다.

---

## 1) 배포 전 필수 결정
- [ ] 플랫폼: Vercel
- [ ] DB: Postgres
- [ ] 세션 저장소: 서버 메모리 금지, DB 또는 Redis
- [ ] 도메인 정책: 단일 도메인(권장) / 분리 도메인(CORS+쿠키 추가설정)

---

## 2) 쿠키/세션 설정(필수)
- [ ] `httpOnly: true`
- [ ] `secure: true` (HTTPS 전용)
- [ ] `sameSite: 'lax'` (기본 권장)
- [ ] 세션 만료시간(`expires_at`) 설정
- [ ] 로그인 성공 시 세션 ID 재발급(세션 고정 공격 방지)
- [ ] 로그아웃 시 세션 즉시 폐기(`revoked_at`)

---

## 3) 인증/권한(필수)
- [ ] 모든 API에서 인증 검사(세션 없으면 401)
- [ ] 모든 API에서 권한 검사(역할/소유권 안 맞으면 403)
- [ ] 존재 은닉 정책(필요 시 404)
- [ ] 기본 거부(`deny by default`): 명시 허용 외 전부 403
- [ ] t(선생) 소유권은 DB 관계(`teacher_students`)로 강제

---

## 4) CSRF/XSS 최소 방어선
- [ ] 상태변경 API(POST/PATCH/DELETE)에 CSRF 방어 적용
- [ ] 사용자 입력 출력 시 HTML escape 유지(React 기본 + `dangerouslySetInnerHTML` 금지)
- [ ] 쿠키 인증은 JS에서 읽지 않도록 httpOnly 유지

---

## 5) DB/마이그레이션 검증
- [ ] `users`, `auth_sessions`, `teachers`, `students`, `sessions`, `consultations`, `payments`, `audit_logs` 생성 확인
- [ ] FK/UNIQUE/CHECK 제약 실제 반영 확인
- [ ] localStorage export/import 후 카운트 일치 확인:
  - [ ] 학생 수
  - [ ] 선생 수
  - [ ] 회차 수
  - [ ] 결제 이벤트 수
  - [ ] 상담 이벤트 수

---

## 6) 감사로그/개인정보
- [ ] `audit_logs`는 append-only (앱/DB에서 update/delete 금지)
- [ ] 로그에 비밀번호/세션토큰 저장 금지
- [ ] 전화번호/이메일 등 PII는 필요 최소만 기록

---

## 7) Vercel 운영 점검
- [ ] 환경변수 설정 완료 (`DATABASE_URL`, `SESSION_SECRET` 등)
- [ ] Preview/Production 환경변수 분리
- [ ] 배포 후 `GET /api/auth/me` 정상 확인
- [ ] 브라우저 DevTools에서 쿠키 속성(`Secure`, `HttpOnly`, `SameSite`) 확인
- [ ] 스케일/재배포 후에도 로그인 유지되는지 확인(세션 영속성)

---

## 8) 장애 시 즉시 확인 순서
1. 쿠키가 생성됐는지 (`Set-Cookie`)  
2. 다음 요청에 쿠키가 붙는지  
3. 세션 저장소(auth_sessions)에 레코드가 있는지  
4. `expires_at`/`revoked_at` 상태  
5. API 권한 미들웨어에서 401/403 원인 로그 확인  

---

## 9) 통과 기준(배포 승인)
- [ ] 관리자/선생/학생 로그인 가능
- [ ] 역할별 금지 API가 모두 403
- [ ] 담당 아닌 학생 접근이 차단됨
- [ ] 상담/결제/환불 상태변경 시 감사로그가 남음
- [ ] 백업 복구 리허설 1회 성공

