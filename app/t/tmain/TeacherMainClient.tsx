"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { findTeacherByLoginEmail } from "@/lib/auth/loginSelection";
import {
  buildAdminTeacherStudentHubPath,
  buildAdminTeacherTmainPath,
  buildTmainNewPath,
} from "@/lib/routes/appRouteBuilder";
import { AUTH_EVENT, loadAuthSession } from "@/lib/auth/supabaseAuth";
import {
  clearCurrentTeacherId,
  loadCurrentTeacherId,
  saveCurrentTeacherId,
} from "@/lib/storage/teachers";
import {
  requestCalendarResyncForStudentIds,
  requestCalendarResyncForStudentIdsByAdmin,
} from "@/lib/storage/sessions";
import TodaySessionsCard from "@/lib/ui/teacher/TodaySessionsCard";
import TeacherStudentListCard from "@/lib/ui/teacher/TeacherStudentListCard";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import {
  buildBadges,
  getDdayMeta,
} from "@/lib/factories/sessionFactories";
import { GATE_EVENT } from "@/lib/ui/common/roleGateStorage";
import { calculateSessionAchievementPercent } from "@/lib/factories/sessionProgressFactory";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import { parseDateTime } from "@/lib/ui/session/format";
import { resolveDurationMinForSessionWithMeta, resolveRulesForIndex } from "@/lib/ui/session/sessionCardFactory";
import type { TeacherSessionRow } from "@/lib/ui/teacher/teacherSessionCardFactory";

type TeacherMainRow = TeacherSessionRow & { diff: number };

type TeacherMainClientProps = {
  initialRole?: "a" | "t";
  adminTeacherToken?: string | null;
  adminPathMode?: "legacy" | "teacherScoped";
};

export default function TeacherMainClient({
  initialRole = "t",
  adminTeacherToken = null,
  adminPathMode = "legacy",
}: TeacherMainClientProps) {
  const router = useRouter();
  const { students, teachers, metricsMap } = useStudentRegistry();
  const [selectedTeacherId, setSelectedTeacherId] = useState<string | null>(() => loadCurrentTeacherId());
  const [isLearningSheetSyncing, setIsLearningSheetSyncing] = useState(false);
  const normalizedAdminTeacherToken = (adminTeacherToken ?? "").trim();
  const teacherId = useMemo(() => {
    if (initialRole === "t") return findTeacherByLoginEmail(teachers)?.id ?? null;
    if (adminPathMode === "teacherScoped" && normalizedAdminTeacherToken) {
      return teachers.find((teacher) => teacher.token === normalizedAdminTeacherToken)?.id ?? null;
    }
    return selectedTeacherId;
  }, [initialRole, teachers, selectedTeacherId, adminPathMode, normalizedAdminTeacherToken]);

  useEffect(() => {
    if (initialRole !== "t") return;
    if (teacherId) saveCurrentTeacherId(teacherId);
    else clearCurrentTeacherId();
  }, [initialRole, teacherId]);

  useEffect(() => {
    const requestGateRefresh = () => { /* useStudentRegistry will handle refresh */ };
    window.addEventListener(GATE_EVENT, requestGateRefresh);
    window.addEventListener(AUTH_EVENT, requestGateRefresh);
    return () => {
      window.removeEventListener(GATE_EVENT, requestGateRefresh);
      window.removeEventListener(AUTH_EVENT, requestGateRefresh);
    };
  }, []);

  const currentTeacherName = useMemo(() => {
    return teachers.find((t) => t.id === teacherId)?.name ?? (teacherId ? `알 수 없음` : "");
  }, [teachers, teacherId]);
  const currentTeacherToken = useMemo(() => {
    const token = teachers.find((teacher) => teacher.id === teacherId)?.token ?? "";
    return token.trim() || null;
  }, [teachers, teacherId]);

  const visibleStudents = useMemo(() => {
    if (!teacherId) return [];
    return Array.from(metricsMap.values())
      .filter(({ student }) => student.teacherId === teacherId)
      .map(({ student }) => student);
  }, [metricsMap, teacherId]);

  const allRows = useMemo<TeacherMainRow[]>(() => {
    const rows: TeacherMainRow[] = [];
    const now = new Date();

    for (const st of visibleStudents) {
      const metrics = metricsMap.get(st.id);
      if (!metrics || !st.token) continue;

      const { sessions } = metrics;

      for (const s of sessions) {
        const dday = getDdayMeta(s.effectiveISO, now);
        if (dday.diff === null) continue;

        // ✅ 학생 페이지와 동일하게 회차별 수업시간(duration)을 반영해 시작~종료시간을 구성
        const rules = resolveRulesForIndex(st, s.index);
        const durationMin = resolveDurationMinForSessionWithMeta(s.effectiveISO, rules, s.meta);
        const { dateText, timeText } = parseDateTime(s.effectiveISO, durationMin);
        
        // ✅ 성취도 퍼센트 계산
        const percent = calculateSessionAchievementPercent({ token: st.token, sessionIndex: s.index });

        // ✅ 세션 상태 배지 및 기타 특수 배지 (마지막 수업 등) 구성
        const badges = buildBadges(s.meta);
        const isLastClass = metrics.lastClassIndex === s.index;

        rows.push({
          studentId: st.id,
          teacherToken: currentTeacherToken ?? undefined,
          token: st.token,
          studentName: st.name,
          index: s.index,
          effectiveISO: s.effectiveISO ?? "",
          dateText,
          timeText,
          status: s.meta.status ?? "planned",
          badges,
          ddayLabel: dday.label,
          ddayClass: dday.className,
          percent,
          lastClass: isLastClass,
          diff: dday.diff,
        });
      }
    }
    return rows;
  }, [visibleStudents, metricsMap, currentTeacherToken]);

  const todayRows = useMemo(
    () => allRows.filter((r) => r.diff === 0).sort((a, b) => a.effectiveISO.localeCompare(b.effectiveISO)),
    [allRows]
  );
  const nextRows = useMemo(() => {
    const future = allRows.filter((r) => r.diff > 0).sort((a, b) => a.effectiveISO.localeCompare(b.effectiveISO));
    // 학생당 최대 2개씩만
    const picked: Record<string, number> = {};
    return future.filter(r => {
      picked[r.studentId] = (picked[r.studentId] || 0) + 1;
      return picked[r.studentId] <= 2;
    });
  }, [allRows]);

  function onClickSyncOwnStudents() {
    const targetStudentIds = visibleStudents
      .map((student) => student.id)
      .filter((id) => typeof id === "string" && id.trim());

    if (targetStudentIds.length === 0) {
      window.alert("동기화할 학생이 없습니다.");
      return;
    }

    const auth = loadAuthSession();
    const hasProviderToken = Boolean((auth?.providerAccessToken ?? "").trim());
    if (!hasProviderToken) {
      window.alert("구글 캘린더 권한 토큰이 없습니다. 홈에서 구글 권한을 다시 연결해주세요.");
      return;
    }

    const teacherLabel = currentTeacherName || "선생님";
    const ok = window.confirm(`${teacherLabel} 담당 학생 ${targetStudentIds.length}명의 회차 동기화를 요청할까요?`);
    if (!ok) return;

    if (initialRole === "a") {
      requestCalendarResyncForStudentIdsByAdmin(targetStudentIds);
      window.alert(
        `요청을 저장했어요.\n\n현재는 관리자 계정이므로 직접 생성하지 않고 pending으로 표시됩니다.\n담당 선생님 계정으로 로그인하면 자동으로 다시 생성됩니다.`
      );
      return;
    }

    requestCalendarResyncForStudentIds(targetStudentIds);
    window.alert("요청을 전송했어요. 2~5초 뒤 학생별 회차 상태를 확인해주세요.");
  }

  async function onClickSyncLearningSheet() {
    if (isLearningSheetSyncing) return;

    if (!teacherId) {
      window.alert("선생님을 먼저 선택해주세요.");
      return;
    }

    const targetStudents = visibleStudents.filter((student) => student.teacherId === teacherId);
    if (targetStudents.length === 0) {
      window.alert("동기화할 학생이 없습니다.");
      return;
    }

    const teacherLabel = currentTeacherName || "선생님";
    const ok = window.confirm(
      `${teacherLabel} 담당 학생 ${targetStudents.length}명의 학습 현황을 구글 시트로 동기화할까요?`
    );
    if (!ok) return;

    setIsLearningSheetSyncing(true);
    try {
      const res = await fetch("/api/ops/learning-sheet/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          teacherId,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            error?: string;
            result?: {
              spreadsheetUrl?: string;
              syncedStudentCount?: number;
              rowsWritten?: number;
            };
          }
        | null;

      if (!res.ok || !payload?.ok || !payload.result) {
        const reason = payload?.error ?? `HTTP_${res.status}`;
        window.alert(`학습 현황 동기화에 실패했습니다.\n사유: ${reason}`);
        return;
      }

      const syncedStudents = payload.result.syncedStudentCount ?? 0;
      const rowsWritten = payload.result.rowsWritten ?? 0;
      const url = (payload.result.spreadsheetUrl ?? "").trim();
      const message =
        `학습 현황 동기화 완료\n` +
        `- 학생 수: ${syncedStudents}명\n` +
        `- 기록 행: ${rowsWritten}행` +
        (url ? `\n- 시트: ${url}` : "");
      window.alert(message);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown_error";
      window.alert(`학습 현황 동기화에 실패했습니다.\n사유: ${reason}`);
    } finally {
      setIsLearningSheetSyncing(false);
    }
  }

  return (
    <main className="p-6">
      <div style={{ marginBottom: 12 }}>
        <RoleGateCard
          role={initialRole}
          teachers={teachers}
          students={students}
          teacherId={teacherId}
          studentToken={null}
          onTeacherChange={(next) => {
            setSelectedTeacherId(next);
            if (initialRole !== "a" || adminPathMode !== "teacherScoped") return;
            const nextToken = (teachers.find((teacher) => teacher.id === next)?.token ?? "").trim();
            if (!nextToken) return;
            router.push(buildAdminTeacherTmainPath(nextToken));
          }}
        />
      </div>

      {initialRole === "a" && (
        <div style={{ marginBottom: 8 }}>
          <button className="btn btn-bold" onClick={() => router.push("/a/amain")}>관리자 페이지</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "end", gap: 12 }}>
        <div />
        <div style={{ textAlign: "center" }}>
          <h1 className="page-title">{currentTeacherName ? `${currentTeacherName} · 학생 관리` : "학생 관리"}</h1>
        </div>
        <div />
      </div>

      <TodaySessionsCard rows={todayRows} role={initialRole} />
      <TodaySessionsCard
        rows={nextRows}
        role={initialRole}
        title="다음 수업"
        emptyText="다음 수업이 없습니다."
        leadBadgeLabel="Next"
        leadBadgeClassName="bg-blue-600 text-white"
      />

      {teacherId ? (
        <TeacherStudentListCard
          students={visibleStudents}
          role={initialRole}
          studentHrefOf={
            initialRole === "a" && currentTeacherToken
              ? (student) =>
                  buildAdminTeacherStudentHubPath({
                    teacherToken: currentTeacherToken,
                    studentToken: student.token,
                  })
              : undefined
          }
          onSyncOwnStudents={onClickSyncOwnStudents}
          onSyncLearningSheet={onClickSyncLearningSheet}
          onAddStudent={() => router.push(buildTmainNewPath(initialRole))}
        />
      ) : (
        <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
          <div className="text-muted">
            {initialRole === "t" ? "로그인 정보와 일치하는 선생님을 찾지 못했습니다." : "선생님을 선택해주세요."}
          </div>
        </section>
      )}
    </main>
  );
}
