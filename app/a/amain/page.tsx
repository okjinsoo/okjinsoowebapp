"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import {
  getStudentStatusMeta,
  getStudentStatusSectionLabel,
  type StudentStatusKind,
} from "@/lib/factories/studentStatusFactory";
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import DriveControlPanel from "@/lib/ui/admin/DriveControlPanel";
import { ymdFromISO_KST } from "@/lib/utils/date";

export default function AdminMainPage() {
  const router = useRouter();
  const { metricsMap } = useStudentRegistry();

  const statusCards = useMemo(() => {
    return Array.from(metricsMap.values()).map(({ student, teacher, status, passedCount, remainingCount, lastSessionISO, latestExtensionRequest }) => ({
      studentId: student.id,
      token: student.token ?? "",
      studentName: student.name ?? "-",
      teacherId: student.teacherId ?? null,
      teacherName: teacher?.name ?? "-",
      status,
      hasExtensionDecision: Boolean(latestExtensionRequest?.extensionResult),
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

  const extensionRequestCards = useMemo(() => {
    return Array.from(metricsMap.values())
      .filter(({ status }) => status === "need_extension")
      .map((metrics) => {
        const { student, teacher, status, remainingCount, latestExtensionRequest, sessions } = metrics;
        const consultDate = latestExtensionRequest?.date;
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

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <h1 className="page-title">관리자 메인</h1>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-blue" onClick={() => router.push("/a/students")} style={{ padding: "10px 14px", fontWeight: 800 }}>학생 관리</button>
        <button className="btn btn-green" onClick={() => router.push("/a/teachers")} style={{ padding: "10px 14px", fontWeight: 800 }}>선생님 관리</button>
      </div>

      <DriveControlPanel />


      {/* 연장 요청 섹션 */}
      {extensionRequestCards.length > 0 && (
        <section style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
          <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>연장 요청</span>
            <Badge tone="blue">{extensionRequestCards.length}명</Badge>
          </div>
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {extensionRequestCards.map((c) => (
              <div
                key={`extension-${c.studentId}`}
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
        </section>
      )}

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
      {["need_extension", "overdue_extension", "paused", "pause_scheduled", "new", "active"].map((sectionType) => {
        const sectionCards = statusCards.filter((c) => {
          if (c.status !== sectionType) return false;
          if (sectionType === "need_extension" && c.hasExtensionDecision) return false;
          return true;
        });
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
