# /t/tmain/new 페이지 정리

## 페이지 한 줄 설명
선생님이 본인 학생을 새로 등록하는 페이지입니다.

## 핵심
- `TeacherStudentNewPageClient(basePath="/t/tmain")`
- 내부 등록 폼은 `StudentNewClient(mode="teacher")`

## 동작
- 로그인 이메일 기준 선생님을 자동 찾고, 그 선생님으로 고정 배정합니다.
- 저장 후 `/t/tmain`으로 돌아갑니다.

## 보호 로직
- 선생님이 매칭되지 않으면 "선생님 선택으로 이동" 안내를 보여줍니다.

## 권한
- `/t/*` 경로이므로 선생님/관리자 계정이 접근 가능합니다.
