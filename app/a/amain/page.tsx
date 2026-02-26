"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { syncRoleBindingEmails } from "@/lib/auth/roleBindings";
import { ensureAuthSession, getSupabaseConfig } from "@/lib/auth/supabaseAuth";
import {
  pullSharedSnapshotAndHydrate,
  pushSharedSnapshot,
  readLocalSharedStateKv,
} from "@/lib/storage/sharedSnapshot";
import { loadStudents } from "@/lib/storage/students";
import { loadTeachers, saveCurrentTeacherId, TEACHERS_EVENT } from "@/lib/storage/teachers";
import { loadSessions, sessionsByStudent } from "@/lib/storage/sessions";
import { loadConsultationsByStudent } from "@/lib/storage/consultations";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  readMetaMap,
  type SessionMeta,
} from "@/lib/factories/sessionFactories";
import {
  computePauseLifecycle,
  computeStudentStatusFromMetrics,
  getStudentStatusMeta,
  getStudentStatusSectionLabel,
  type StudentStatusKind,
} from "@/lib/factories/studentStatusFactory";
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import { kstDateMs, todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";

type StudentStatusCard = {
  studentId: string;
  token: string;
  studentName: string;
  teacherId?: string | null;
  teacherName: string;
  status: StudentStatusKind;
  passedCount: number;
  remainingCount: number;
  lastSessionLabel: string;
};

type PauseRequestCard = {
  studentId: string;
  token: string;
  studentName: string;
  teacherId?: string | null;
  teacherName: string;
  status: StudentStatusKind;
  consultIndex: number;
  remainingCount: number;
  consultDateTimeLabel: string;
};

function findConsultTargetSessionIndex(args: {
  token: string;
  sessions: ReturnType<typeof sessionsByStudent>;
  baseDatesISO: string[];
  metaMap: Record<number, SessionMeta>;
  consultDate?: string;
}) {
  const { token, sessions, baseDatesISO, metaMap, consultDate } = args;
  if (!consultDate || sessions.length === 0) return null;

  const entries = sessions
    .map((s) => {
      const { effectiveISO } = computeEffectiveISO({
        token,
        index: s.index,
        baseDatesISO,
        metaMap,
      });
      const iso = effectiveISO ?? "";
      const ms = iso ? new Date(iso).getTime() : NaN;
      return { index: s.index, iso, ms, ymd: ymdFromISO_KST(iso) ?? "" };
    })
    .filter((e) => Number.isFinite(e.ms));

  if (entries.length === 0) return null;

  const same = entries.filter((e) => e.ymd === consultDate).sort((a, b) => a.index - b.index);
  if (same.length > 0) return same[0].index;

  const targetMs = new Date(`${consultDate}T00:00:00+09:00`).getTime();
  const future = entries.filter((e) => e.ms >= targetMs).sort((a, b) => a.ms - b.ms);
  if (future.length > 0) return future[0].index;

  const past = entries.filter((e) => e.ms < targetMs).sort((a, b) => b.ms - a.ms);
  if (past.length > 0) return past[0].index;

  return null;
}

export default function AdminMainPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [students, setStudents] = useState(() => loadStudents());
  const [teachers, setTeachers] = useState(() => loadTeachers());
  const [metaTick, setMetaTick] = useState(0);
  const [syncingRoles, setSyncingRoles] = useState(false);
  const [syncResult, setSyncResult] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await pullSharedSnapshotAndHydrate();
      } catch (err) {
        console.error("공유 스냅샷 불러오기 실패(admin):", err);
      }
      if (cancelled) return;

      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setMounted(true);
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      setStudents(loadStudents());
      setTeachers(loadTeachers());
    };
    const onMetaUpdated = () => setMetaTick((x) => x + 1);
    window.addEventListener("tutorweb:studentsUpdated", refresh);
    window.addEventListener("tutorweb:sessionsUpdated", refresh);
    window.addEventListener("tutorweb:consultationsUpdated", refresh);
    window.addEventListener("tutorweb:metaMapUpdated", onMetaUpdated);
    window.addEventListener(TEACHERS_EVENT, refresh);
    return () => {
      window.removeEventListener("tutorweb:studentsUpdated", refresh);
      window.removeEventListener("tutorweb:sessionsUpdated", refresh);
      window.removeEventListener("tutorweb:consultationsUpdated", refresh);
      window.removeEventListener("tutorweb:metaMapUpdated", onMetaUpdated);
      window.removeEventListener(TEACHERS_EVENT, refresh);
    };
  }, []);

  const statusCards = useMemo<StudentStatusCard[]>(() => {
    if (!mounted) return [];
    void metaTick;
    const today = todayYmdKST();

    const cards: StudentStatusCard[] = [];

    for (const st of students) {
      if (!st.token) continue;
      const sessions = sessionsByStudent(st.id);
      const baseDatesISO = buildBaseDatesISOByToken(st.token, 60);
      const metaMap = readMetaMap(st.token);

      let passedCount = 0;
      let lastSessionISO: string | null = null;

      for (const s of sessions) {
        const { effectiveISO } = computeEffectiveISO({
          token: st.token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });
        if (!effectiveISO) continue;
        const ymd = ymdFromISO_KST(effectiveISO);
        if (ymd && ymd < today) passedCount += 1;
        if (!lastSessionISO || effectiveISO > lastSessionISO) lastSessionISO = effectiveISO;
      }

      const totalCount = Math.max(0, st.planCount ?? 0, sessions.length);
      const remainingCount = Math.max(0, totalCount - passedCount);
      const finishedAll = totalCount > 0 && passedCount >= totalCount;
      const lastYmd = lastSessionISO ? ymdFromISO_KST(lastSessionISO) ?? "" : "";
      const todayMs = kstDateMs(today);
      const lastMs = lastYmd ? kstDateMs(lastYmd) : null;
      const overdueDays =
        finishedAll && todayMs !== null && lastMs !== null
          ? Math.floor((todayMs - lastMs) / 86400000)
          : 0;

      const pauseDate = st.pauseEffectiveDate;
      const latestPause = [...loadConsultationsByStudent(st.id)]
        .filter((r) => r.purpose === "pause_request")
        .sort((a, b) => {
          const ad = `${a.date ?? ""}|${a.createdAt ?? ""}`;
          const bd = `${b.date ?? ""}|${b.createdAt ?? ""}`;
          return ad.localeCompare(bd);
        })
        .at(-1);

      const pauseLifecycle = computePauseLifecycle(today, pauseDate);
      const status = computeStudentStatusFromMetrics({
        pauseLifecycle,
        hasPendingPauseRequest: Boolean(latestPause && !latestPause.finalResult),
        overdueDays,
        remainingCount,
        passedCount,
      });

      cards.push({
        studentId: st.id,
        token: st.token,
        studentName: st.name ?? "-",
        teacherId: st.teacherId ?? null,
        teacherName: teachers.find((t) => t.id === st.teacherId)?.name ?? "-",
        status,
        passedCount,
        remainingCount,
        lastSessionLabel: lastSessionISO ? fmtKST_yyyyMMdd_HHmm_noSeconds(lastSessionISO) : "-",
      });
    }

    return cards.sort((a, b) => a.studentName.localeCompare(b.studentName, "ko"));
  }, [mounted, students, teachers, metaTick]);

  const sectionOrder: StudentStatusKind[] = [
    "need_extension",
    "new",
    "pause_scheduled",
    "paused",
    "overdue_extension",
  ];
  const grouped = useMemo(() => {
    const out: Record<StudentStatusKind, StudentStatusCard[]> = {
      new: [],
      active: [],
      need_extension: [],
      overdue_extension: [],
      pause_requested: [],
      pause_scheduled: [],
      paused: [],
    };
    for (const card of statusCards) out[card.status].push(card);
    return out;
  }, [statusCards]);

  const pauseRequestCards = useMemo<PauseRequestCard[]>(() => {
    if (!mounted) return [];
    void metaTick;
    const statusByStudentId = new Map(statusCards.map((c) => [c.studentId, c] as const));
    const cards: PauseRequestCard[] = [];

    for (const st of students) {
      if (!st.token) continue;
      const list = loadConsultationsByStudent(st.id);
      if (!list.length) continue;

      const latestPause = [...list]
        .filter((r) => r.purpose === "pause_request")
        .sort((a, b) => {
          const ad = `${a.date ?? ""}|${a.createdAt ?? ""}`;
          const bd = `${b.date ?? ""}|${b.createdAt ?? ""}`;
          return ad.localeCompare(bd);
        })
        .at(-1);

      if (!latestPause) continue;
      if (latestPause.finalResult === "pause_cancel" || latestPause.finalResult === "pause_confirm") continue;

      const statusCard = statusByStudentId.get(st.id);
      const baseDatesISO = buildBaseDatesISOByToken(st.token, 60);
      const metaMap = readMetaMap(st.token);
      const sessions = sessionsByStudent(st.id);
      const consultIndex = findConsultTargetSessionIndex({
        token: st.token,
        sessions,
        baseDatesISO,
        metaMap,
        consultDate: latestPause.date,
      });
      if (!consultIndex) continue;
      const { effectiveISO } = computeEffectiveISO({
        token: st.token,
        index: consultIndex,
        baseDatesISO,
        metaMap,
      });

      cards.push({
        studentId: st.id,
        token: st.token,
        studentName: st.name ?? "-",
        teacherId: st.teacherId ?? null,
        teacherName: teachers.find((t) => t.id === st.teacherId)?.name ?? "-",
        status: statusCard?.status ?? "active",
        consultIndex,
        remainingCount: statusCard?.remainingCount ?? 0,
        consultDateTimeLabel: effectiveISO ? fmtKST_yyyyMMdd_HHmm_noSeconds(effectiveISO) : "-",
      });
    }

    return cards.sort((a, b) => {
      const av = a.consultDateTimeLabel === "-" ? "9999" : a.consultDateTimeLabel;
      const bv = b.consultDateTimeLabel === "-" ? "9999" : b.consultDateTimeLabel;
      return av.localeCompare(bv) || a.studentName.localeCompare(b.studentName, "ko");
    });
  }, [mounted, students, teachers, statusCards, metaTick]);

  async function onClickRoleSyncTest() {
    setSyncResult("");

    const cfg = getSupabaseConfig();
    if (!cfg) {
      setSyncResult("실패: Supabase 환경변수(NEXT_PUBLIC_SUPABASE_URL/ANON_KEY)가 비어 있어요.");
      return;
    }

    const session = await ensureAuthSession();
    if (!session?.accessToken) {
      setSyncResult("실패: 로그인 토큰이 만료됐어요. 홈에서 다시 로그인 후 다시 눌러주세요.");
      return;
    }

    const teacherEmails = teachers
      .map((t) => (t.email ?? "").trim().toLowerCase())
      .filter(Boolean);
    const studentEmails = students
      .map((s) => (s.googleEmail ?? "").trim().toLowerCase())
      .filter(Boolean);
    const sessions = loadSessions();

    try {
      setSyncingRoles(true);

      const [, , snapshotResult] = await Promise.all([
        syncRoleBindingEmails({
          previousEmails: [],
          nextEmails: teacherEmails,
          role: "teacher",
          accessToken: session.accessToken,
        }),
        syncRoleBindingEmails({
          previousEmails: [],
          nextEmails: studentEmails,
          role: "student",
          accessToken: session.accessToken,
        }),
        pushSharedSnapshot({ teachers, students, sessions, stateKv: readLocalSharedStateKv() }),
      ]);

      if (snapshotResult.sessionsSynced && snapshotResult.stateKvSynced) {
        setSyncResult(
          `성공: 선생님 ${teacherEmails.length}개, 학생 ${studentEmails.length}개 이메일을 role_bindings에 동기화했고, 회차 ${sessions.length}개와 학습 상태를 포함해 공유 스냅샷으로 올렸어요.`
        );
      } else {
        const missing: string[] = [];
        if (!snapshotResult.sessionsSynced) missing.push("sessions(005)");
        if (!snapshotResult.stateKvSynced) missing.push("state_kv(006)");
        setSyncResult(`부분 성공: role_bindings는 동기화됐지만, DB 컬럼 ${missing.join(", ")} 이 없어 일부 공유를 건너뛰었습니다. SQL 마이그레이션 실행 후 다시 눌러주세요.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      setSyncResult(`실패: ${msg}`);
    } finally {
      setSyncingRoles(false);
    }
  }

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <h1 className="page-title">관리자 메인</h1>
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-blue"
          onClick={() => router.push("/a/students")}
          style={{ padding: "10px 14px", fontWeight: 800 }}
        >
          학생 관리
        </button>
        <button
          className="btn btn-green"
          onClick={() => router.push("/a/teachers")}
          style={{ padding: "10px 14px", fontWeight: 800 }}
        >
          선생님 관리
        </button>
      </div>

      <section
        style={{
          marginTop: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 12,
          background: "#f8fafc",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>권한 동기화 테스트</div>
        <button
          onClick={onClickRoleSyncTest}
          disabled={syncingRoles}
          style={{ padding: "10px 12px", fontWeight: 800 }}
        >
          {syncingRoles ? "동기화 중..." : "role_bindings 강제 동기화 실행"}
        </button>
        <div style={{ marginTop: 8, color: "#334155", fontSize: 13, lineHeight: 1.5 }}>
          {syncResult || "네트워크 탭 대신, 이 버튼으로 성공/실패 메시지를 바로 확인할 수 있어요."}
        </div>
      </section>

      <section
        style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}
      >
        <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>휴회 요청</span>
          <Badge tone="gray">{pauseRequestCards.length}명</Badge>
        </div>
        {pauseRequestCards.length === 0 ? (
          <div className="text-muted" style={{ marginTop: 8 }}>
            휴회 요청 학생이 없습니다.
          </div>
        ) : (
          <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
            {pauseRequestCards.map((c) => (
              <div
                key={`pause-${c.studentId}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr 1.4fr",
                  gap: 12,
                  alignItems: "center",
                  padding: "8px 10px",
                  border: "1px solid var(--surface-border)",
                  borderRadius: 8,
                  background: "var(--surface-bg)",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
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
                <div>{c.teacherName}</div>
                <div>{c.consultIndex}회차</div>
                <div>{c.remainingCount}회차</div>
                <div>{c.consultDateTimeLabel}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {sectionOrder.map((kind) => (
        <section
          key={kind}
          style={{ marginTop: 16, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}
        >
          <div className="card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{getStudentStatusSectionLabel(kind)}</span>
            <Badge tone="gray">{grouped[kind].length}명</Badge>
          </div>
          {grouped[kind].length === 0 ? (
            <div className="text-muted" style={{ marginTop: 8 }}>
              해당 학생이 없습니다.
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
              {grouped[kind].map((c) => {
                const meta = getStudentStatusMeta(c.status);
                return (
                  <div
                    key={c.studentId}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.2fr 1fr 0.8fr 0.8fr 1.4fr",
                      gap: 12,
                      alignItems: "center",
                      padding: "8px 10px",
                      border: "1px solid var(--surface-border)",
                      borderRadius: 8,
                      background: "var(--surface-bg)",
                      cursor: "pointer",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f3f4f6")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                    onClick={() => {
                      if (c.teacherId) saveCurrentTeacherId(c.teacherId);
                      saveCurrentStudentToken(c.token);
                      router.push("/a/smain");
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>{c.studentName}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                    <div>{c.teacherName}</div>
                    <div>{c.passedCount}회차</div>
                    <div>{c.remainingCount}회차</div>
                    <div>{c.lastSessionLabel}</div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
