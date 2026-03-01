# 일일 자동 백업 설정 가이드

목표:
- 하루 1번 자동으로 `main` 스냅샷을 백업합니다.
- 저장 위치: `public.app_state_snapshot_backups`

## 1) Supabase SQL 실행

1. Supabase -> SQL Editor 이동
2. `/Users/okjinsoo/Project/TutorWEB/v1/db/migrations/009_daily_snapshot_backups.sql` 내용을 그대로 붙여넣기
3. `Run`

성공 확인 SQL:

```sql
select to_regclass('public.app_state_snapshot_backups') as backup_table;
```

결과가 `app_state_snapshot_backups`면 정상입니다.

## 2) Vercel 환경변수 추가

Vercel -> Project -> Settings -> Environment Variables

다음 2개를 추가하세요.

1. `SUPABASE_SERVICE_ROLE_KEY`
- 값: Supabase 프로젝트의 service role key
- 위치: Supabase -> Settings -> API -> service_role key

2. `CRON_BACKUP_SECRET`
- 값: 직접 만든 긴 랜덤 문자열
- 예: `backup_2026_xxxxxxxxxxxxxxxxxxxxx`

## 3) 배포 후 수동 테스트

관리자 로그인 상태에서 브라우저로 아래 주소 접속:

- `/api/ops/backup/daily`

성공 응답 예:

```json
{
  "ok": true,
  "backupDate": "2026-03-01",
  "inserted": true,
  "backupId": "main-2026-03-01",
  "message": "일일 백업 저장 완료"
}
```

## 4) 실제 스케줄

`/Users/okjinsoo/Project/TutorWEB/v1/vercel.json` 기준:

- `0 18 * * *` (UTC)
- 한국 시간(KST) 기준 매일 03:00

## 5) 백업 데이터 확인

```sql
select
  backup_date,
  source,
  created_at,
  jsonb_array_length(teachers) as teacher_count,
  jsonb_array_length(students) as student_count,
  jsonb_array_length(sessions) as session_count
from public.app_state_snapshot_backups
order by created_at desc
limit 30;
```

