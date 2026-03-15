"use client";

import React, { useState, useEffect } from "react";
import { loadAuthSession, buildGoogleAuthUrl } from "@/lib/auth/supabaseAuth";
import { ensureFolder, requestDrive, shareFolderWithEmail } from "@/lib/integrations/googleDriveSync";
import { pushSharedSnapshot, readRemoteSharedStateKvValue } from "@/lib/storage/sharedSnapshot";
import { SHARED_DRIVE_ROOT_ID_KEY } from "@/lib/storage/sharedStateKeys";
import { loadTeachers } from "@/lib/storage/teachers";
import { loadStudents, saveStudentsServerFirst } from "@/lib/storage/students";

export default function DriveControlPanel() {
  const [driveRootId, setDriveRootId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [manualDriveId, setManualDriveId] = useState("");

  useEffect(() => {
    void (async () => {
      const val = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
      setDriveRootId(val);
    })();
  }, []);

  const handleInitDriveRoot = async () => {
    try {
      setIsBusy(true);
      const auth = loadAuthSession();
      const providerToken = auth?.providerAccessToken;
      if (!providerToken) throw new Error("구글 계정 연결이 필요합니다. 로그아웃 후 다시 로그인해 주세요.");

      const brandId = await ensureFolder({ token: providerToken, name: "01_옥진수학", parentId: "root" });
      const studentsId = await ensureFolder({ token: providerToken, name: "01_Students", parentId: brandId });

      await pushSharedSnapshot({ stateKv: { [SHARED_DRIVE_ROOT_ID_KEY]: studentsId } });
      setDriveRootId(studentsId);

      setBatchProgress("선생님들과 사물함 권한을 공유하는 중...");
      const allTeachers = loadTeachers();
      for (const t of allTeachers) {
        if (t.email?.includes("@")) {
          await shareFolderWithEmail({ token: providerToken, fileId: studentsId, email: t.email });
        }
      }
      
      window.alert("본진 드라이브 설정 및 선생님 공유가 완료되었습니다!");
    } catch (err) {
      console.error("본진 설정 실패:", err);
      if (err instanceof Error && err.message.includes("만료")) {
        if (window.confirm("구글 인증이 만료되었습니다. 다시 로그인하여 권한을 갱신할까요?")) {
          const url = buildGoogleAuthUrl(`${window.location.origin}/auth/callback`, true);
          if (url) window.location.href = url;
        }
      } else {
        window.alert("오류 발생: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
      }
    } finally {
      setIsBusy(false);
      setBatchProgress("");
    }
  };

  const handleManualSetDriveRoot = async () => {
    if (!manualDriveId.trim()) return;
    try {
      setIsBusy(true);
      const auth = loadAuthSession();
      const providerToken = auth?.providerAccessToken;
      if (!providerToken) throw new Error("구글 계정 연결이 필요합니다.");

      const targetId = manualDriveId.trim();
      setBatchProgress("폴더 확인 중...");
      await requestDrive({ token: providerToken, method: "GET", path: `/files/${targetId}`, query: { fields: "id, name" } });

      await pushSharedSnapshot({ stateKv: { [SHARED_DRIVE_ROOT_ID_KEY]: targetId } });
      setDriveRootId(targetId);

      setBatchProgress("선생님 공유 중...");
      const allTeachers = loadTeachers();
      for (const t of allTeachers) {
        if (t.email?.includes("@")) {
          await shareFolderWithEmail({ token: providerToken, fileId: targetId, email: t.email });
        }
      }
      window.alert("수동 지정 완료!");
      setManualDriveId("");
    } catch (err) {
      window.alert("지정 실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsBusy(false);
      setBatchProgress("");
    }
  };

  const handleResetDriveRoot = async () => {
    const clearStudents = window.confirm("본진 초기화 시 전 학생의 사물함 배정도 함께 초기화할까요?");
    try {
      setIsBusy(true);
      await pushSharedSnapshot({ stateKv: { [SHARED_DRIVE_ROOT_ID_KEY]: "" } });
      setDriveRootId(null);
      if (clearStudents) {
        const sts = loadStudents().map(st => ({ ...st, driveFolderId: undefined }));
        await saveStudentsServerFirst(sts);
      }
      window.alert("초기화 완료!");
    } catch (err) {
      window.alert("실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsBusy(false);
    }
  };

  const handleBatchInvite = async () => {
    if (!driveRootId) return window.alert("본진 설정이 필요합니다.");
    const auth = loadAuthSession();
    const token = auth?.providerAccessToken;
    if (!token) return window.alert("구글 계정 연결이 필요합니다.");

    const sts = loadStudents();
    if (!window.confirm(`${sts.length}명 일괄 정비할까요?`)) return;

    try {
      setIsBusy(true);
      const nextSts = [...sts];
      for (let i = 0; i < nextSts.length; i++) {
        const st = nextSts[i];
        setBatchProgress(`[${i + 1}/${sts.length}] ${st.name} 정비 중...`);
        const fid = await ensureFolder({ token, name: `${st.cohort}_${st.name}`, parentId: driveRootId });
        nextSts[i] = { ...st, driveFolderId: fid };
        if (st.googleEmail?.includes("@")) {
          await shareFolderWithEmail({ token, fileId: fid, email: st.googleEmail });
        }
      }
      await saveStudentsServerFirst(nextSts);
      window.alert("일괄 정비 완료!");
    } catch (err) {
      window.alert("오류: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsBusy(false);
      setBatchProgress("");
    }
  };

  return (
    <section style={{ marginTop: 12, border: "1px solid #fecaca", borderRadius: 12, padding: 12, background: "#fff5f5" }}>
      <div style={{ fontWeight: 800, marginBottom: 8, color: "#dc2626" }}>🔥 구글 드라이브 본진 설정 (매우 중요)</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn btn-black"
          onClick={handleInitDriveRoot}
          disabled={isBusy}
          style={{ padding: "10px 14px", fontWeight: 800, background: "#dc2626", color: "white", border: "none", borderRadius: 8 }}
        >
          {isBusy ? (batchProgress || "작업 중...") : "1. 본진 드라이브 자동 구축"}
        </button>

        <div style={{ display: "flex", gap: 4, alignItems: "center", border: "1px solid var(--surface-border)", borderRadius: 10, padding: "4px 8px", background: "var(--surface-bg)", minWidth: 320 }}>
          <input 
            type="text" 
            placeholder="직접 폴더 ID 입력"
            value={manualDriveId}
            onChange={(e) => setManualDriveId(e.target.value)}
            style={{ border: "none", background: "transparent", outline: "none", fontSize: 13, flex: 1, color: "var(--foreground)" }}
          />
          <button 
            onClick={handleManualSetDriveRoot}
            disabled={isBusy || !manualDriveId.trim()}
            style={{ padding: "6px 10px", borderRadius: 8, background: "var(--brand-primary)", color: "white", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800 }}
          >
            수동 지정
          </button>
        </div>

        {driveRootId && (
          <button className="btn" onClick={handleResetDriveRoot} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 800, background: "#fee2e2", color: "#991b1b", border: "1px solid #fecaca", borderRadius: 8 }}>
            본진 리셋
          </button>
        )}

        <button
          className="btn btn-black"
          onClick={handleBatchInvite}
          disabled={isBusy || !driveRootId}
          style={{ padding: "10px 14px", fontWeight: 800, background: "#991b1b", color: "white", border: "none", borderRadius: 8, opacity: (!driveRootId || isBusy) ? 0.5 : 1 }}
        >
          2. 학생 사물함 일괄 정비
        </button>
      </div>
      {batchProgress && (
        <div style={{ marginTop: 10, padding: "8px 12px", background: "#fff", border: "1px solid #dc2626", borderRadius: 8, color: "#dc2626", fontWeight: 700, fontSize: 14 }}>
          ⏳ {batchProgress}
        </div>
      )}
    </section>
  );
}
