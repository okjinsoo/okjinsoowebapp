# /s/smain/session 페이지 정리

## 페이지 한 줄 설명
학생이 자신의 회차 목록(예정/지난 수업)을 확인하는 페이지입니다.

## 화면 구성
- `StudentMainSessionListBase(role="s")`
- 내부 핵심은 `StudentSessionListCore(role="s")`

## 학생 기준 동작
- 회차 카드(날짜/상태/성취도)는 조회 가능
- 상담/퀵 액션 버튼은 `role=s` 정책으로 숨김

## 권한
- `/s/*` 경로이므로 접근은 가능하지만 편집 액션은 제한됩니다.
