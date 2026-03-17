"use client";

import React, { useState } from "react";
import { loadAuthSession } from "@/lib/auth/supabaseAuth";
import { requestDrive } from "@/lib/integrations/googleDriveSync";
import { requestGoogle, APP_EVENT_MARKER } from "@/lib/integrations/googleCalendarSync";
import { pushSharedSnapshot, readRemoteSharedStateKvValue } from "@/lib/storage/sharedSnapshot";
import { SHARED_DRIVE_ROOT_ID_KEY } from "@/lib/storage/sharedStateKeys";
import type { Student, Session } from "@/lib/types/index";

export default function RescueCenter() {
  const [isBusy, setIsBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [foundStudents, setFoundStudents] = useState<Student[]>([]);
  const [foundSessions, setFoundSessions] = useState<Session[]>([]);

  const addLog = (msg: string) => setLogs(prev => [...prev.slice(-10), `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleScan = async () => {
    try {
      setIsBusy(true);
      setLogs([]);
      setFoundStudents([]);
      setFoundSessions([]);
      
      const auth = loadAuthSession();
      const token = auth?.providerAccessToken;
      if (!token) throw new Error("구글 권한이 없습니다. 다시 로그인해 주세요.");

      addLog("1. 드라이브 본진 ID 확인 중...");
      const studentsFolderId = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
      if (!studentsFolderId) throw new Error("드라이브 본진 설정이 되어 있지 않습니다.");

      addLog("2. 구글 드라이브에서 학생 사물함 목록 스캔 중...");
      const driveRes = await requestDrive({
        token,
        method: "GET",
        path: "/files",
        query: {
          q: `'${studentsFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: "files(id, name)",
          pageSize: "100",
        }
      }) as { files: { id: string; name: string }[] };

      const students: Student[] = driveRes.files.map(f => {
        // "기수_이름" 형식 파싱 시도
        const parts = f.name.split("_");
        const name = parts[1] || parts[0];
        const cohort = parts.length > 1 ? parts[0] : "미정";
        
        return {
          id: f.id, 
          name,
          cohort,
          googleEmail: "", // 이메일은 캘린더나 드라이브 권한 목록에서 나중에 추출 가능
          token: `restore-${f.id.slice(-8)}`,
          status: "active",
          memo: "자동 복구됨",
          planCount: 0,
          paymentHistory: [],
        };
      });
      setFoundStudents(students);
      addLog(`학생 ${students.length}명 발견 완료.`);

      addLog("3. 구글 캘린더에서 '옥진수학' 일정 스캔 중...");
      // 전용 캘린더 ID 찾기
      const calListRes = await requestGoogle({
        token,
        method: "GET",
        path: "/users/me/calendarList",
        query: { maxResults: "100" }
      }) as { items: { id: string; summary: string }[] };
      const appCalId = calListRes.items.find(c => c.summary === "옥진수학")?.id || "primary";

      const eventsRes = await requestGoogle({
        token,
        method: "GET",
        path: `/calendars/${encodeURIComponent(appCalId)}/events`,
        query: {
          q: APP_EVENT_MARKER,
          maxResults: "500",
          showDeleted: "false",
          singleEvents: "true",
          orderBy: "startTime",
        }
      }) as { items: any[] };

      const sessions: Session[] = eventsRes.items.map(ev => {
        const desc = ev.description || "";
        const studentName = desc.match(/학생: (.*)/)?.[1]?.trim() || "";
        const indexMatch = desc.match(/회차: (\d+)/);
        const index = indexMatch ? parseInt(indexMatch[1]) : 1;
        const sessionId = ev.extendedProperties?.private?.tutorweb_session_id || `rec-${ev.id.slice(-8)}`;
        const studentId = ev.extendedProperties?.private?.tutorweb_student_id || 
                         students.find(s => s.name === studentName)?.id || "unknown";

        return {
          id: sessionId,
          studentId,
          index,
          displayAt: ev.start?.dateTime || ev.start?.date || "",
          title: ev.summary?.replace(/.* \d+회차 /, "") || "수업",
          memo: desc.match(/메모: (.*)/)?.[1]?.trim() || "",
          googleCalendarEventId: ev.id,
          googleCalendarId: appCalId,
          googleCalendarStatus: "synced",
        };
      });

      // 학생 이메일 보정 (캘린더 이벤트 참석자에서 추출)
      const updatedStudents = students.map(s => {
        const studentEvents = sessions.filter(sess => sess.studentId === s.id);
        if (studentEvents.length > 0) {
          // 실제 이메일 정보는 캘린더 이벤트 본체에서 다시 가져와야 함 (상세 정보 필요 시 생략 가능)
        }
        return s;
      });

      setFoundStudents(updatedStudents);
      setFoundSessions(sessions);
      addLog(`수업 일정 ${sessions.length}개 복구 준비 완료.`);

    } catch (err) {
      addLog(`에러 발생: ${err instanceof Error ? err.message : "복구 실패"}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleApply = async () => {
    if (!window.confirm(`발견된 학생 ${foundStudents.length}명과 수업 ${foundSessions.length}개를 서버에 저장할까요?`)) return;
    try {
      setIsBusy(true);
      addLog("서버 전송 중...");
      
      await pushSharedSnapshot({
        students: foundStudents,
        sessions: foundSessions,
      });

      addLog("🎉 복구 데이터 적용 성공! 페이지를 새로고침해 주세요.");
      window.alert("복구가 완료되었습니다. 이제 학생 명단이 보일 것입니다.");
      window.location.reload();
    } catch (err) {
      addLog(`적용 실패: ${err instanceof Error ? err.message : "서버 통신 오류"}`);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section className="mt-4 p-5 border-2 border-red-500 rounded-3xl bg-red-50/50 shadow-lg">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">🆘</span>
        <h2 className="text-lg font-black text-red-600">데이터 긴급 복구 센터</h2>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <button
            onClick={handleScan}
            disabled={isBusy}
            className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 disabled:opacity-50 shadow-md transform active:scale-95 transition-all"
          >
            {isBusy ? "데이터 추적 중..." : "1. 명단 및 일정 스캔 시작"}
          </button>
          
          {foundStudents.length > 0 && (
            <button
              onClick={handleApply}
              disabled={isBusy}
              className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 disabled:opacity-50 shadow-md transform active:scale-95 transition-all"
            >
              2. 최종 복구 적용
            </button>
          )}
        </div>

        <div className="bg-white/80 border border-red-200 rounded-2xl p-4 min-h-[100px] max-h-[200px] overflow-y-auto font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-gray-400 italic">복구 버튼을 누르면 작업 로그가 여기에 표시됩니다.</div>
          ) : (
            logs.map((log, i) => <div key={i} className="mb-1">{log}</div>)
          )}
        </div>

        {foundStudents.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {foundStudents.map((s, i) => (
              <div key={i} className="p-2 bg-white border border-gray-100 rounded-xl text-xs flex items-center justify-between shadow-sm">
                <span className="font-bold text-gray-700">{s.name}</span>
                <span className="text-[10px] text-gray-400">{s.cohort}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
