# /a/students/[token]/session 페이지 정리

## 페이지 한 줄 설명
특정 학생(token)의 회차 목록을 바로 보여주는 페이지입니다.

## 핵심
- `StudentSessionListCore(role="a", prefix="/a/students")`를 사용합니다.
- 예정/지난 수업을 나눠 보여주고, 상담/퀵액션을 제공합니다.

## 차이점
- `/a/smain/session`은 "선택 학생" 기반
- 이 페이지는 "URL token 고정" 기반

## 권한
- `/a/*` 경로이므로 관리자만 접근 가능합니다.
