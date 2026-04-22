# /t/tmain/[token]/edit 페이지 정리

## 페이지 한 줄 설명
선생님이 특정 학생(token)을 직접 수정하는 페이지입니다.

## 현재 연결
- `StudentEditTokenPageClient(mode="teacher")`
- 완료 후 `/t/tmain`으로 복귀

## 동작 메모
- mode는 `teacher`이지만, 현재 구현상 `fixedTeacherId`가 전달되지 않는 경로라
  배정 선생님 변경 제한이 완전하지 않을 수 있습니다.
- 삭제 버튼은 관리자 모드가 아니라 기본적으로 숨김입니다.

## 권한
- `/t/*` 경로이므로 선생님/관리자 계정이 접근 가능합니다.
