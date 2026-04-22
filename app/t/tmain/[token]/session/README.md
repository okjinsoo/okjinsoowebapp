# /t/tmain/[token]/session 페이지 정리

## 페이지 한 줄 설명
선생님 문맥에서 특정 학생의 회차 목록을 보는 페이지입니다.

## 핵심
- `StudentSessionListCore(role="t", prefix="/t/tmain")`
- 예정/지난 수업, 상담 버튼, 퀵 액션 제공

## 용도
- `/t/tmain`에서 학생을 클릭했을 때 문맥을 유지한 회차 목록 화면

## 권한
- `/t/*` 경로이므로 선생님/관리자 계정이 접근 가능합니다.
