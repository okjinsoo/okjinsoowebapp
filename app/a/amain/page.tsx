"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { syncRoleBindingEmails } from "@/lib/auth/roleBindings";
import {
  pullSharedSnapshotAndHydrateWithOptions,
  pushSharedSnapshot,
  readLocalSharedStateKv,
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";
import { loadStudents, saveStudentsServerFirst } from "@/lib/storage/students";
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
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { kstDateMs, todayYmdKST, ymdFromISO_KST } from "@/lib/utils/date";
import { buildGoogleAuthUrl, ensureAuthSession, getSupabaseConfig, loadAuthSession } from "@/lib/auth/supabaseAuth";
import { ensureFolder, requestDrive, shareFolderWithEmail } from "@/lib/integrations/googleDriveSync";
import { SHARED_DRIVE_ROOT_ID_KEY } from "@/lib/storage/sharedStateKeys";

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
  
  // 구글 드라이브 본진 설정 관련
  const [isSavingDrive, setIsSavingDrive] = useState(false);
  const [driveRootId, setDriveRootId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState("");
  const [manualDriveId, setManualDriveId] = useState("");

  useEffect(() => {
    if (!mounted) return;
    void (async () => {
      const val = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
      setDriveRootId(val);
    })();
  }, [mounted]);

  const handleInitDriveRoot = async () => {
    try {
      setIsSavingDrive(true);
      
      const auth = loadAuthSession();
      const providerToken = auth?.providerAccessToken;
      if (!providerToken) throw new Error("구글 계정 연결이 필요합니다. 로그아웃 후 다시 로그인해 주세요.");

      // 1. 01_옥진수학 -> 01_Students 경로 확보
      // 명시적으로 'root'(내 드라이브 최상단)에서 찾도록 하여 엉뚱한 하위 폴더가 잡히는 것을 방지
      const brandId = await ensureFolder({ token: providerToken, name: "01_옥진수학", parentId: "root" });
      const studentsId = await ensureFolder({ token: providerToken, name: "01_Students", parentId: brandId });

      // 2. 확보된 ID를 시스템 본진으로 저장
      await pushSharedSnapshot({
        stateKv: {
          [SHARED_DRIVE_ROOT_ID_KEY]: studentsId
        }
      });
      setDriveRootId(studentsId);

      // ⚠️ 추가: 등록된 모든 선생님들에게 이메일 권한 공유 (404 방지)
      try {
        setBatchProgress("선생님들과 사물함 권한을 공유하는 중...");
        const allTeachers = loadTeachers();
        for (const t of allTeachers) {
          if (t.email?.includes("@")) {
            await shareFolderWithEmail({
              token: providerToken,
              fileId: studentsId,
              email: t.email
            });
          }
        }
      } catch (shareErr) {
        console.error("선생님 공유 실패(무시하고 진행):", shareErr);
      }
      
      window.alert("본진 드라이브 설정 및 선생님 공유가 완료되었습니다!");
    } catch (err) {
      console.error("본진 설정 실패:", err);
      const isAuthErr = err instanceof Error && err.message.includes("만료");
      if (isAuthErr) {
        if (window.confirm("구글 인증이 만료되었습니다. 다시 로그인하여 권한을 갱신할까요?")) {
          const url = buildGoogleAuthUrl(`${window.location.origin}/auth/callback`, true);
          if (url) window.location.href = url;
        }
      } else {
        window.alert("본진 설정 중 오류가 발생했습니다: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
      }
    } finally {
      setIsSavingDrive(false);
    }
  };

  const handleManualSetDriveRoot = async () => {
    if (!manualDriveId.trim()) return;
    try {
      setIsSavingDrive(true);
      const auth = loadAuthSession();
      const providerToken = auth?.providerAccessToken;
      if (!providerToken) throw new Error("구글 계정 연결이 필요합니다. 로그아웃 후 다시 로그인해 주세요.");

      const targetId = manualDriveId.trim();
      setBatchProgress("입력하신 폴더 정보를 확인하는 중...");

      // 폴더 존재 여부 및 메타데이터 확인
      await requestDrive({
        token: providerToken,
        method: "GET",
        path: `/files/${targetId}`,
        query: { fields: "id, name, mimeType" }
      });

      // 시스템 본진으로 저장
      await pushSharedSnapshot({
        stateKv: { [SHARED_DRIVE_ROOT_ID_KEY]: targetId }
      });
      setDriveRootId(targetId);

      // 선생님 자동 공유
      try {
        setBatchProgress("선생님들과 사물함 권한을 공유하는 중...");
        const allTeachers = loadTeachers();
        for (const t of allTeachers) {
          if (t.email?.includes("@")) {
            await shareFolderWithEmail({
              token: providerToken,
              fileId: targetId,
              email: t.email
            });
          }
        }
      } catch (shareErr) {
        console.error("선생님 공유 실패(무시):", shareErr);
      }

      window.alert("본진 드라이브 수동 지정 및 선생님 공유가 완료되었습니다!");
      setManualDriveId("");
    } catch (err) {
      console.error("수동 지정 실패:", err);
      window.alert("지정에 실패했습니다. 폴더 ID가 정확한지 확인해 주세요.\n(에러: " + (err instanceof Error ? err.message : "알 수 없는 오류") + ")");
    } finally {
      setIsSavingDrive(false);
      setBatchProgress("");
    }
  };
  const handleResetDriveRoot = async () => {
    const clearStudents = window.confirm("현재 설정된 본진 드라이브 정보를 초기화할까요?\n\n[확인]을 누르면 본진 위치가 초기화됩니다.\n이때 학생들의 기존 사물함 배정 정보도 함께 초기화할까요? (권장)");
    
    try {
      setIsSavingDrive(true);
      
      // 1. 본진 ID 초기화
      await pushSharedSnapshot({
        stateKv: {
          [SHARED_DRIVE_ROOT_ID_KEY]: ""
        }
      });
      setDriveRootId(null);

      // 2. 학생들의 사물함 ID도 초기화 (사용자 선택 시)
      if (clearStudents) {
        setBatchProgress("모든 학생의 사물함 배정 정보를 초기화하는 중...");
        const nextStudents = students.map(st => ({ ...st, driveFolderId: undefined }));
        await saveStudentsServerFirst(nextStudents);
        setStudents(nextStudents);
      }

      window.alert("본진 정보가 초기화되었습니다. 이제 '1. 입지 선정' 버튼을 눌러 올바른 경로를 다시 잡아주세요.");
    } catch (err) {
      window.alert("초기화 실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsSavingDrive(false);
      setBatchProgress("");
    }
  };

  const handleBatchInvite = async () => {
    if (!driveRootId) {
      window.alert("먼저 본진 드라이브 설정을 완료해 주세요.");
      return;
    }
    
    const auth = loadAuthSession();
    const providerToken = auth?.providerAccessToken;
    if (!providerToken) {
      window.alert("구글 계정 연결이 필요합니다.");
      return;
    }

    if (!window.confirm(`${students.length}명의 학생 사물함(폴더)을 생성하고 각 학생만 접근하도록 보안 초대를 보낼까요?\n(이미 생성된 경우 초대만 추가됩니다)`)) return;

    try {
      setIsSavingDrive(true);
      let successCount = 0;
      let failCount = 0;
      const nextStudents = [...students];

      for (let i = 0; i < nextStudents.length; i++) {
        const st = nextStudents[i];
        setBatchProgress(`[${i + 1}/${nextStudents.length}] ${st.name} 학생 사물함 정비 중...`);
        
        try {
          // 1. 학생별 사물함 폴더 생성 (이미 있으면 ID만 반환)
          const folderName = `${st.cohort}_${st.name}`;
          const fid = await ensureFolder({ token: providerToken, name: folderName, parentId: driveRootId });

          // 2. 학생 데이터에 폴더 ID 저장 (메모리 업데이트)
          nextStudents[i] = { ...st, driveFolderId: fid };

          // 3. 학생 이메일로만 개별 초대
          if (st.googleEmail?.includes("@")) {
            await shareFolderWithEmail({
              token: providerToken,
              fileId: fid,
              email: st.googleEmail
            });
          }
          successCount++;
        } catch (innerErr) {
          console.error(`${st.name} 폴더 작업 실패:`, innerErr);
          failCount++;
        }
      }

      setBatchProgress("장부 서버에 기록 중... 잠시만 기다려 주세요.");
      // 4. 업데이트된 학생 정보를 서버 및 로컬에 저장 (스냅샷 강제 동기화)
      await saveStudentsServerFirst(nextStudents);
      setStudents(nextStudents);

      setBatchProgress("");
      window.alert(`정비 완료! (총 ${nextStudents.length}명)\n- 사물함 번호 배정 성공: ${successCount}명\n- 실패: ${failCount}명\n\n이제 학생들이 사진을 올릴 때 원장님이 배정한 사물함으로만 배달됩니다.`);
    } catch (err) {
      console.error("일괄 초대 실패:", err);
      window.alert("작업 중 오류가 발생했습니다: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsSavingDrive(false);
      setBatchProgress("");
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
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
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, refresh);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, refresh);
    window.addEventListener(TUTORWEB_EVENTS.consultationsUpdated, refresh);
    window.addEventListener(TUTORWEB_EVENTS.metaMapUpdated, onMetaUpdated);
    window.addEventListener(TEACHERS_EVENT, refresh);
    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, refresh);
      window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, refresh);
      window.removeEventListener(TUTORWEB_EVENTS.consultationsUpdated, refresh);
      window.removeEventListener(TUTORWEB_EVENTS.metaMapUpdated, onMetaUpdated);
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
          border: "1px solid #fecaca",
          borderRadius: 12,
          padding: 12,
          background: "#fff5f5",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8, color: "#dc2626" }}>🔥 구글 드라이브 본진 설정 (매우 중요)</div>
        <div style={{ marginBottom: 12, fontSize: 13, color: "#991b1b", lineHeight: 1.4 }}>
          학생들이 과제를 제출할 '중앙 집하장' 폴더를 원장님의 드라이브에 만듭니다.<br/>
          <strong>설정 후, 드라이브에서 해당 폴더를 학생들에게 [편집자]로 공유해주세요.</strong>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="btn btn-black"
            onClick={handleInitDriveRoot}
            disabled={isSavingDrive}
            style={{ 
              padding: "10px 14px", 
              fontWeight: 800,
              background: "#dc2626",
              color: "white",
              border: "none",
              borderRadius: 8
            }}
          >
            {isSavingDrive ? (batchProgress || "기지 구축 중...") : "1. 본진 드라이브 자동 구축"}
          </button>

          <div 
            style={{ 
              display: "flex", 
              gap: 4, 
              alignItems: "center", 
              border: "1px solid var(--surface-border)", 
              borderRadius: 10, 
              padding: "4px 8px", 
              background: "var(--surface-bg)",
              minWidth: 320
            }}
          >
            <input 
              type="text" 
              placeholder="직접 폴더 ID 입력 (예: 1abc...)"
              value={manualDriveId}
              onChange={(e) => setManualDriveId(e.target.value)}
              style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: "var(--foreground)" }}
            />
            <button 
              onClick={handleManualSetDriveRoot}
              disabled={isSavingDrive || !manualDriveId.trim()}
              style={{ 
                padding: "6px 10px", 
                borderRadius: 8, 
                background: isSavingDrive ? "var(--surface-bg)" : "var(--brand-primary)", 
                color: isSavingDrive ? "var(--text-muted)" : "white",
                border: "none", 
                cursor: "pointer", 
                fontSize: 12, 
                fontWeight: 800 
              }}
            >
              수동 지정
            </button>
          </div>

          {driveRootId && (
            <button
              className="btn"
              onClick={handleResetDriveRoot}
              disabled={isSavingDrive}
              style={{ 
                padding: "10px 14px", 
                fontWeight: 800,
                background: "#fee2e2",
                color: "#991b1b",
                border: "1px solid #fecaca",
                borderRadius: 8
              }}
            >
              본진 위치 초기화 (리셋)
            </button>
          )}

          <button
            className="btn btn-black"
            onClick={handleBatchInvite}
            disabled={isSavingDrive || !driveRootId}
            style={{ 
              padding: "10px 14px", 
              fontWeight: 800,
              background: "#991b1b",
              color: "white",
              border: "none",
              borderRadius: 8,
              opacity: (!driveRootId || isSavingDrive) ? 0.5 : 1
            }}
          >
            {isSavingDrive ? "사물함 정비 중..." : "2. 학생 사물함 일괄 정비 (보안 강화)"}
          </button>
        </div>
        {batchProgress && (
          <div style={{ 
            marginTop: 10, 
            padding: "8px 12px", 
            background: "#fff", 
            border: "1px solid #dc2626", 
            borderRadius: 8,
            color: "#dc2626",
            fontWeight: 700,
            fontSize: 14,
            animation: "pulse 2s infinite"
          }}>
            ⏳ {batchProgress}
          </div>
        )}
        {driveRootId && (
          <div style={{ marginTop: 8, fontSize: 12, color: "#b91c1c", opacity: 0.8 }}>
            현재 설정된 본진 ID: {driveRootId}
          </div>
        )}
      </section>

      <section
        style={{
          marginTop: 12,
          border: "1px solid var(--surface-border)",
          borderRadius: 12,
          padding: 12,
          background: "var(--surface-bg)",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>권한 동기화 테스트</div>
        <button
          className="btn-white"
          onClick={onClickRoleSyncTest}
          disabled={syncingRoles}
          style={{ padding: "10px 12px", fontWeight: 800 }}
        >
          {syncingRoles ? "동기화 중..." : "role_bindings 강제 동기화 실행"}
        </button>
        <div style={{ marginTop: 8, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
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
