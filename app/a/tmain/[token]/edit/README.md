# /a/tmain/[token]/edit 페이지 정리

## 페이지 한 줄 설명
`tmain` 문맥에서 특정 학생(token)을 수정하는 페이지입니다.

## 동작
- `StudentEditTokenPageClient(mode="admin", onDoneGoTo="/a/tmain")`를 사용합니다.
- 수정 완료 후 `/a/tmain`으로 복귀합니다.

## 수정 내용
- 학생 기본정보/연락처/학교/학년/이메일
- 배정 선생님, 시작일, 회차 수
- 관리자라면 삭제 기능도 사용 가능합니다.

## 권한
- `/a/*` 경로이므로 관리자만 접근 가능합니다.
