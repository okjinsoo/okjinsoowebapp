# /a/tmain/new 페이지 정리

## 페이지 한 줄 설명
관리자 모드에서 선생님 소속 학생을 새로 등록하는 페이지입니다.

## 핵심
- `TeacherStudentNewPageClient(basePath="/a/tmain")`를 사용합니다.
- 내부 등록 폼은 `StudentNewClient(mode="teacher")`를 재사용합니다.

## 동작 요약
- 선택된 선생님을 기준으로 신규 학생을 만듭니다.
- 저장 후 `/a/tmain`으로 돌아갑니다.
- 선생님이 선택되지 않은 상태면 먼저 선택 화면으로 유도합니다.

## 권한
- `/a/*` 경로이므로 관리자만 접근 가능합니다.
