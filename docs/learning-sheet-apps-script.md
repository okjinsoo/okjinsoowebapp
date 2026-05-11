# Google Sheets 메뉴 연동 (현재 탭 동기화)

학습현황 시트 상단 메뉴(`파일 | 수정 | ...`) 옆에 `학습동기화` 메뉴를 만들고,
현재 탭 기준으로 TutorWEB 동기화 공장을 호출하는 Apps Script 예시입니다.

## 1) 사전 준비

1. Vercel 배포 주소 확인
- 예: `https://okjinsoowebapp.vercel.app`

2. 서버 비밀키 준비
- `.env`에 `LEARNING_SHEET_MENU_SECRET` 설정
- 배포 환경에도 동일 키 반영

3. 스프레드시트 열기
- `확장 프로그램 > Apps Script` 이동

## 2) Apps Script 코드

```javascript
const WEBHOOK_URL = 'https://okjinsoowebapp.vercel.app/api/ops/learning-sheet/sync-by-sheet';
const MENU_SECRET = 'LEARNING_SHEET_MENU_SECRET_값';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('학습동기화')
    .addItem('현재 탭 동기화', 'syncCurrentTab')
    .addToUi();
}

function syncCurrentTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const tabTitle = sheet.getName();

  const payload = {
    spreadsheetId: ss.getId(),
    tabTitle,
  };

  const res = UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${MENU_SECRET}`,
    },
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const body = res.getContentText();

  if (code >= 200 && code < 300) {
    SpreadsheetApp.getActive().toast('현재 탭 동기화 완료', '학습동기화', 4);
    return;
  }

  SpreadsheetApp.getUi().alert(`동기화 실패 (${code})\n${body}`);
}
```

## 3) 동작 방식

- 메뉴 클릭 시 현재 탭 이름 + 스프레드시트 ID를 서버로 전송
- 서버는 해당 시트를 관리하는 선생님 매핑을 찾은 뒤
  현재 탭 학생 1명만 다시 동기화

## 4) 주의

- 관리자 OAuth/Refresh Token 설정이 먼저 완료되어야 정상 동작합니다.
- 탭 이름이 학생 규칙(`기수_이름`)과 다르면 대상 매칭이 되지 않을 수 있습니다.
