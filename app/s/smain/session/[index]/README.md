# /s/smain/session/[index] 페이지 정리

## 페이지 한 줄 설명
학생이 특정 회차 상세를 확인/학습 제출하는 페이지입니다.

## 화면 구성
- `StudentMainSessionDetailBase(role="s")`
- 내부:
  - `SessionTopBarCore(role="s")`
  - `SessionClientCore(role="s")`

## 학생이 할 수 있는 일
- 회차 정보/강의 항목 확인
- 필기/풀이 제출(Drive 업로드)
- 제출 링크 확인

## 학생이 할 수 없는 일
- 출결/조정/상담 편집
- 강의 추가/삭제/순서 변경
- 내부 식별 정보 보기

## 권한
- `/s/*` 경로이므로 접근은 가능하지만, 수정 권한은 role 정책으로 막힙니다.
