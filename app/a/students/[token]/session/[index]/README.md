# /a/students/[token]/session/[index] 페이지 정리

## 페이지 한 줄 설명
특정 학생의 특정 회차를 URL로 직접 여는 상세 학습 페이지입니다.

## 화면 구성
- `SessionTopBarCore(role="a")`
- `SessionClientCore(role="a")`

## 할 수 있는 일
- 출결/회차 조정/상담 관리
- Meet 연결 상태 확인
- 강의 추가/삭제/순서 변경
- 공지/임시문제 추가
- 필기/풀이 제출 링크 확정

## 데이터 저장
- 회차 학습 상태는 stateKv 기반 키(`session leaf ids`, `progress`)로 서버와 동기화됩니다.

## 권한
- `/a/*` 경로이므로 관리자만 접근 가능합니다.
