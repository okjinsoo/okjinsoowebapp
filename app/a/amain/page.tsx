"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  buildAdminTeacherStudentHubPath,
  buildAdminTeacherTmainPath,
} from "@/lib/routes/appRouteBuilder";
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

export default function AdminMainPage() {
  const { metricsMap } = useStudentRegistry();

  const statusCards = useMemo(() => {
    return Array.from(metricsMap.values()).map(({ student, teacher, status, passedCount, remainingCount, lastSessionISO }) => ({
      studentId: student.id,
      token: student.token ?? "",
      teacherToken: teacher?.token ?? "",
      studentName: student.name ?? "-",
      teacherId: student.teacherId ?? null,
      teacherName: teacher?.name ?? "-",
      status,
      passedCount,
      remainingCount,
      lastSessionLabel: lastSessionISO ? fmtKST_yyyyMMdd_HHmm_noSeconds(lastSessionISO) : "-",
    })).sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [metricsMap]);

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <h1 className="page-title">관리자 메인</h1>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn btn-blue" href="/a/students" style={{ padding: "10px 14px", fontWeight: 800, textDecoration: "none" }}>
          학생 관리
        </Link>
        <Link className="btn btn-green" href="/a/teachers" style={{ padding: "10px 14px", fontWeight: 800, textDecoration: "none" }}>
          선생님 관리
        </Link>
      </div>

      <DriveControlPanel />

      {/* 섹션별 학생 현황 요약 */}
      {["need_extension", "new", "active"].map((sectionType) => {
        const sectionCards = statusCards.filter((c) => c.status === sectionType);
        if (sectionCards.length === 0) return null;
        return (
          <section key={sectionType} style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>{getStudentStatusSectionLabel(sectionType as StudentStatusKind)}</span>
              <Badge tone={getStudentStatusMeta(sectionType as StudentStatusKind).tone}>{sectionCards.length}명</Badge>
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {sectionCards.map((c) => (
                <Link
                  key={c.studentId}
                  href={
                    c.teacherToken
                      ? buildAdminTeacherStudentHubPath({
                          teacherToken: c.teacherToken,
                          studentToken: c.token,
                        })
                      : buildAdminTeacherTmainPath(c.token)
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr 1.4fr",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    cursor: "pointer",
                    background: "var(--surface-bg)",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={() => {
                    if (c.teacherId) saveCurrentTeacherId(c.teacherId);
                    saveCurrentStudentToken(c.token);
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{c.studentName}</span>
                  </div>
                  <div>{teacherNamePrefix(c.teacherName)}</div>
                  <div>남은 {c.remainingCount}회차</div>
                  <div>{c.lastSessionLabel}</div>
                </Link>
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
