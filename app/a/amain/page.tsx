"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { syncRoleBindingEmails } from "@/lib/auth/roleBindings";
import {
  pushSharedSnapshot,
  readLocalSharedStateKv,
} from "@/lib/storage/sharedSnapshot";
import { loadSessions } from "@/lib/storage/sessions";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import {
  getStudentStatusMeta,
  getStudentStatusSectionLabel,
  type StudentStatusKind,
} from "@/lib/factories/studentStatusFactory";
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import { ensureAuthSession, getSupabaseConfig } from "@/lib/auth/supabaseAuth";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import DriveControlPanel from "@/lib/ui/admin/DriveControlPanel";
import { ymdFromISO_KST } from "@/lib/utils/date";

export default function AdminMainPage() {
  const router = useRouter();
  const { students, teachers, metricsMap } = useStudentRegistry();
  const [syncingRoles, setSyncingRoles] = useState(false);
  const [syncResult, setSyncResult] = useState("");

  const statusCards = useMemo(() => {
    return Array.from(metricsMap.values()).map(({ student, teacher, status, passedCount, remainingCount, lastSessionISO }) => ({
      studentId: student.id,
      token: student.token ?? "",
      studentName: student.name ?? "-",
      teacherId: student.teacherId ?? null,
      teacherName: teacher?.name ?? "-",
      status,
      passedCount,
      remainingCount,
      lastSessionLabel: lastSessionISO ? fmtKST_yyyyMMdd_HHmm_noSeconds(lastSessionISO) : "-",
    })).sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [metricsMap]);

  const pauseRequestCards = useMemo(() => {
    return Array.from(metricsMap.values())
      .filter(({ latestPauseRequest }) => latestPauseRequest && !latestPauseRequest.finalResult)
      .map((metrics) => {
        const { student, teacher, status, remainingCount, latestPauseRequest, sessions } = metrics;
        const consultDate = latestPauseRequest?.date;
        const targetSession = sessions.find(s => ymdFromISO_KST(s.effectiveISO) === consultDate);
        const consultDateTimeLabel = targetSession?.effectiveISO ?? "-";

        return {
          studentId: student.id,
          token: student.token ?? "",
          studentName: student.name ?? "-",
          teacherId: student.teacherId ?? null,
          teacherName: teacher?.name ?? "-",
          status,
          consultIndex: metrics.consultIndex ?? 0,
          remainingCount,
          consultDateTimeLabel: consultDateTimeLabel !== "-" ? fmtKST_yyyyMMdd_HHmm_noSeconds(consultDateTimeLabel) : "-",
        };
      })
      .sort((a, b) => a.consultDateTimeLabel.localeCompare(b.consultDateTimeLabel) || a.studentName.localeCompare(b.studentName, "ko"));
  }, [metricsMap]);

  async function onClickRoleSyncTest() {
    setSyncResult("");
    const cfg = getSupabaseConfig();
    const session = await ensureAuthSession();
    if (!cfg || !session?.accessToken) {
      setSyncResult("실패: 인증 정보가 부족합니다. 홈에서 다시 로그인해주세요.");
      return;
    }

    try {
      setSyncingRoles(true);
      const teacherEmails = teachers.map((t) => (t.email ?? "").trim().toLowerCase()).filter(Boolean);
      const studentEmails = students.map((s) => (s.googleEmail ?? "").trim().toLowerCase()).filter(Boolean);

      const [, , snapshotResult] = await Promise.all([
        syncRoleBindingEmails({ previousEmails: [], nextEmails: teacherEmails, role: "teacher", accessToken: session.accessToken }),
        syncRoleBindingEmails({ previousEmails: [], nextEmails: studentEmails, role: "student", accessToken: session.accessToken }),
        pushSharedSnapshot({ teachers, students, sessions: loadSessions(), stateKv: readLocalSharedStateKv() }),
      ]);

      if (snapshotResult.sessionsSynced && snapshotResult.stateKvSynced) {
        setSyncResult(`성공: 선생님 ${teacherEmails.length}개, 학생 ${studentEmails.length}개 이메일 및 스냅샷 동기화 완료!`);
      } else {
        setSyncResult("부분 성공: role_bindings는 동기화됐지만, DB 스냅샷 업로드에 일부 제한이 있었습니다.");
      }
    } catch (err) {
      setSyncResult(`실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`);
    } finally {
      setSyncingRoles(false);
    }
  }

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <h1 className="page-title">관리자 메인</h1>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-blue" onClick={() => router.push("/a/students")} style={{ padding: "10px 14px", fontWeight: 800 }}>학생 관리</button>
        <button className="btn btn-green" onClick={() => router.push("/a/teachers")} style={{ padding: "10px 14px", fontWeight: 800 }}>선생님 관리</button>
      </div>

      <DriveControlPanel />

      <section style={{ marginTop: 12, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 12, background: "var(--surface-bg)" }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>권한 동기화 테스트</div>
        <button className="btn-white" onClick={onClickRoleSyncTest} disabled={syncingRoles} style={{ padding: "10px 12px", fontWeight: 800 }}>
          {syncingRoles ? "동기화 중..." : "role_bindings 강제 동기화 실행"}
        </button>
        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>{syncResult || "상태를 한눈에 확인할 수 있습니다."}</div>
      </section>

      {/* 휴회 요청 섹션 */}
      <section style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>휴회 요청</span>
          <Badge tone="gray">{pauseRequestCards.length}명</Badge>
        </div>
        {pauseRequestCards.length === 0 ? (
          <div className="text-muted" style={{ marginTop: 8 }}>휴회 요청 학생이 없습니다.</div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {pauseRequestCards.map((c) => (
              <div
                key={`pause-${c.studentId}`}
                style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr 1.4fr", gap: 12, alignItems: "center", padding: "8px 10px", border: "1px solid var(--surface-border)", borderRadius: 8, background: "var(--surface-bg)", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                onClick={() => {
                  if (c.teacherId) saveCurrentTeacherId(c.teacherId);
                  saveCurrentStudentToken(c.token);
                  router.push("/a/smain");
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{c.studentName}</span>
                  <Badge tone={getStudentStatusMeta(c.status).tone}>{getStudentStatusMeta(c.status).label}</Badge>
                </div>
                <div>{teacherNamePrefix(c.teacherName)}</div>
                <div>{c.consultIndex}회차</div>
                <div>{c.remainingCount}회차</div>
                <div>{c.consultDateTimeLabel}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 섹션별 학생 현황 요약 */}
      {["need_extension", "overdue_extension", "paused", "pause_scheduled", "new"].map((sectionType) => {
        const sectionCards = statusCards.filter(c => c.status === sectionType);
        if (sectionCards.length === 0) return null;
        return (
          <section key={sectionType} style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>{getStudentStatusSectionLabel(sectionType as StudentStatusKind)}</span>
              <Badge tone={getStudentStatusMeta(sectionType as StudentStatusKind).tone}>{sectionCards.length}명</Badge>
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {sectionCards.map((c) => (
                <div
                  key={c.studentId}
                  style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1.4fr", gap: 12, alignItems: "center", padding: "8px 10px", border: "1px solid var(--surface-border)", borderRadius: 8, cursor: "pointer", background: "var(--surface-bg)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={() => {
                    if (c.teacherId) saveCurrentTeacherId(c.teacherId);
                    saveCurrentStudentToken(c.token);
                    router.push("/a/smain");
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{c.studentName}</span>
                  </div>
                  <div>{teacherNamePrefix(c.teacherName)}</div>
                  <div>남은 {c.remainingCount}회차</div>
                  <div>{c.lastSessionLabel}</div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

function teacherNamePrefix(name: string) {
  return name.length > 3 ? name.substring(0, 3) : name;
}
