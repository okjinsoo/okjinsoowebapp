# /a/smain/session/[index] 페이지 정리

## 페이지 한 줄 설명
선택한 한 회차의 상세 학습 화면입니다.

## 화면 구성
- 상단: `RoleGateCard`
- 본문:
  - `SessionTopBarCore(role="a")`
  - `SessionClientCore(role="a")`

## SessionTopBarCore에서 하는 일
- 출석/결석 토글
- 회차 조정(변경 날짜/시간, 이월, 사유/기록)
- Google Meet 열기
- 상담 모달 열기
- 구글 권한 오류 시 "다시 연결" 배너 제공

## SessionClientCore에서 하는 일
- 강의 배치/추가/삭제/순서 변경
- 공지 추가, 문제 추가(임시 항목)
- 필기/풀이 제출(Drive 업로드 모달)
- 진도 체크 및 제출 링크 관리

## 권한 차이(이 페이지는 관리자)
- 관리자이므로 강의 배치 변경, 삭제, 순서 저장 같은 교사 권한 기능까지 모두 가능

## 권한
- `/a/*` 경로이므로 관리자만 접근 가능합니다.
