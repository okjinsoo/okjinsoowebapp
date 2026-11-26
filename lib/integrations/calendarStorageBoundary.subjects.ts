// 임시 어댑터(0단계): 현재 코드의 함수 이름을 테스트용 이름에 연결합니다.
// 리팩토링이 끝나면 이 파일은 지우고 테스트가 새 모듈을 직접 import 합니다.
import type { Session } from "@/lib/types/index";
import { saveSessions } from "@/lib/storage/sessions";
import { requestResetAndResyncMeetForStudentIds } from "@/lib/integrations/sessionCalendarActions";

type SessionOpts = Parameters<typeof saveSessions>[1];

export { saveSessionsAndSyncCalendar } from "@/lib/integrations/sessionCalendarActions";

export function saveSessionsWithoutCalendar(list: Session[], options?: SessionOpts): void {
  saveSessions(list, options);
}

export {
  saveStudentsAndResyncCalendar,
  saveTeachersAndResyncCalendar,
} from "@/lib/integrations/rosterCalendarActions";

export { requestResetAndResyncMeetForStudentIds };
