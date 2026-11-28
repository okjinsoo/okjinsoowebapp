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
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/factories/format";
import Badge from "@/lib/ui/common/Badge";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import DriveControlPanel from "@/lib/ui/admin/DriveControlPanel";
import { buildRoundBar } from "@/lib/factories/roundBar";
import RoundBarView from "@/lib/ui/common/RoundBarView";
import { getDdayMeta } from "@/lib/factories/ddayMeta";
import { buildAdminSummary } from "@/lib/factories/adminSummary";
import { todayYmdKST } from "@/lib/utils/date";

export default function AdminMainPage() {
  const { metricsMap } = useStudentRegistry();

  const statusCards = useMemo(() => {
    const nowMs = currentMs();
    // 재학(active) 학생만: 종료·휴원 학생이 '처리할 일'에 계속 남지 않게
    return Array.from(metricsMap.values())
      .filter(({ student }) => student.status === "active")
      .map(({ student, teacher, status, remainingCount, lastSessionISO, sessions }) => ({
        studentId: student.id,
        token: student.token ?? "",
        teacherToken: teacher?.token ?? "",
        studentName: student.name ?? "-",
        teacherId: student.teacherId ?? null,
        teacherName: teacher?.name ?? "-",
        status,
        remainingCount,
        lastSessionISO,
        lastSessionLabel: lastSessionISO ? fmtKST_yyyyMMdd_HHmm_noSeconds(lastSessionISO) : "-",
        roundBar: buildRoundBar({ student, sessions, nowMs }),
      }))
      .sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [metricsMap]);

  const summary = useMemo(() => buildAdminSummary(Array.from(metricsMap.values()), todayYmdKST()), [metricsMap]);
  const extensionCards = useMemo(
    () =>
      statusCards
        .filter((c) => c.status === "need_extension")
        .sort((a, b) => (a.lastSessionISO ?? "").localeCompare(b.lastSessionISO ?? "")),
    [statusCards],
  );

  function hrefOf(c: (typeof statusCards)[number]) {
    return c.teacherToken
      ? buildAdminTeacherStudentHubPath({ teacherToken: c.teacherToken, studentToken: c.token })
      : buildAdminTeacherTmainPath(c.token);
  }

  function rememberSelection(c: (typeof statusCards)[number]) {
    if (c.teacherId) saveCurrentTeacherId(c.teacherId);
    saveCurrentStudentToken(c.token);
  }

  const stats: Array<{ label: string; value: number; alert?: boolean }> = [
    { label: "재학생", value: summary.activeCount },
    { label: "이번 주 수업", value: summary.weekSessionCount },
    { label: "연장 필요", value: summary.extensionCount, alert: summary.extensionCount > 0 },
    { label: "이번 달 결제", value: summary.monthPaymentCount },
  ];

  return (
    <main style={{ padding: 20, width: "100%", maxWidth: 960, margin: "0 auto" }}>
      <h1 className="page-title">관리자 메인</h1>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link className="btn btn-blue" href="/a/students" style={{ padding: "10px 14px", fontWeight: 800, textDecoration: "none" }}>
          학생 관리
        </Link>
        <Link className="btn btn-green" href="/a/teachers" style={{ padding: "10px 14px", fontWeight: 800, textDecoration: "none" }}>
          선생님 관리
        </Link>
      </div>

      <section className="admin-stats" aria-label="요약 숫자">
        {stats.map((it) => (
          <div
            key={it.label}
            style={{
              border: `1px solid ${it.alert ? "var(--wait)" : "var(--surface-border)"}`,
              borderRadius: 12,
              padding: "12px 14px",
              background: "var(--surface-bg)",
            }}
          >
            <div className="text-muted" style={{ fontSize: 13 }}>{it.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: it.alert ? "var(--wait)" : "inherit" }}>{it.value}</div>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 16, border: "2px solid var(--wait)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>처리할 일 · 연장 필요</span>
          <Badge tone={getStudentStatusMeta("need_extension").tone}>{extensionCards.length}명</Badge>
        </div>
        {extensionCards.length === 0 ? (
          <div className="text-muted" style={{ marginTop: 8 }}>지금 연장이 필요한 학생이 없습니다.</div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {extensionCards.map((c) => {
              const dday = getDdayMeta(c.lastSessionISO, new Date());
              const ddayText = dday.diff === null ? "-" : dday.diff < 0 ? `${-dday.diff}일 지남` : dday.label;
              return (
                <Link key={c.studentId} href={hrefOf(c)} className="admin-row" onClick={() => rememberSelection(c)}>
                  <span style={{ fontWeight: 700 }}>{c.studentName}</span>
                  <span className="text-muted">{teacherNamePrefix(c.teacherName)}</span>
                  <span>
                    마지막 수업 <b style={{ color: "var(--wait)" }}>{ddayText}</b> · 남은 {c.remainingCount}회
                  </span>
                  <span className="text-muted">{c.lastSessionLabel}</span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {(["new", "active"] as const).map((sectionType) => {
        const sectionCards = statusCards.filter((c) => c.status === sectionType);
        if (sectionCards.length === 0) return null;
        return (
          <section key={sectionType} className="card-box" style={{ marginTop: 16 }}>
            <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>{getStudentStatusSectionLabel(sectionType as StudentStatusKind)}</span>
              <Badge tone={getStudentStatusMeta(sectionType as StudentStatusKind).tone}>{sectionCards.length}명</Badge>
            </div>
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {sectionCards.map((c) => (
                <Link key={c.studentId} href={hrefOf(c)} className="admin-row" onClick={() => rememberSelection(c)}>
                  <span style={{ fontWeight: 700 }}>{c.studentName}</span>
                  <span className="text-muted">{teacherNamePrefix(c.teacherName)}</span>
                  <span>{c.roundBar ? <RoundBarView bar={c.roundBar} /> : `남은 ${c.remainingCount}회`}</span>
                  <span className="text-muted">{c.lastSessionLabel}</span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}

      <DriveControlPanel />
    </main>
  );
}

function currentMs() {
  return Date.now();
}

function teacherNamePrefix(name: string) {
  return name.length > 3 ? name.substring(0, 3) : name;
}
