# /a/students/[token]/edit 페이지 정리

## 페이지 한 줄 설명
URL token으로 지정된 학생을 직접 수정하는 페이지입니다.

## 특징
- `StudentEditTokenPageClient(mode="admin")`를 사용합니다.
- 학생 선택 저장값이 없어도 URL token만으로 대상이 결정됩니다.

## 수정/저장/삭제
- 수정 항목/저장 로직/삭제 로직은 `/a/smain/edit`와 동일한 `StudentEditClient`를 사용합니다.
- 완료 후 이동 경로는 `/a/smain`입니다.

## 권한
- `/a/*` 경로이므로 관리자만 접근 가능합니다.
