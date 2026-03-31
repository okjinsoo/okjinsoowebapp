"use client";

import React, { useState, useEffect } from "react";
import { loadAuthSession, buildGoogleAuthUrl } from "@/lib/auth/supabaseAuth";
import { ensureFolder, requestDrive, shareFolderWithEmail } from "@/lib/integrations/googleDriveSync";
import { pushSharedSnapshot, readRemoteSharedStateKvValue } from "@/lib/storage/sharedSnapshot";
import { readTeachersServerFirst } from "@/lib/storage/serverRead";
import { SHARED_DRIVE_ROOT_ID_KEY } from "@/lib/storage/sharedStateKeys";

export default function DriveControlPanel() {
  const [driveRootId, setDriveRootId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [showIdInput, setShowIdInput] = useState(false);
  const [manualDriveId, setManualDriveId] = useState("");

  useEffect(() => {
    void (async () => {
      const val = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
      setDriveRootId(val);
    })();
  }, []);

  const handleInitDriveRoot = async () => {
    if (!window.confirm("구글 드라이브에 '01_옥진수학' 폴더를 새로 만들고 본진으로 설정할까요?")) return;
    try {
      setIsBusy(true);
      const auth = loadAuthSession();
      const providerToken = auth?.providerAccessToken;
      if (!providerToken) throw new Error("구글 계정 연결이 필요합니다. 홈에서 구글 권한을 다시 연결해 주세요.");

      setBatchProgress("폴더 생성 및 설정 중...");
      const brandId = await ensureFolder({ token: providerToken, name: "01_옥진수학", parentId: "root" });
      const studentsId = await ensureFolder({ token: providerToken, name: "01_Students", parentId: brandId });

      await pushSharedSnapshot({ stateKv: { [SHARED_DRIVE_ROOT_ID_KEY]: studentsId } });
      setDriveRootId(studentsId);

      setBatchProgress("선생님들과 권한을 공유하는 중...");
      const allTeachers = (await readTeachersServerFirst()).teachers;
      for (const t of allTeachers) {
        if (t.email?.includes("@")) {
          await shareFolderWithEmail({ token: providerToken, fileId: studentsId, email: t.email });
        }
      }
      
      window.alert("본진 드라이브 자동 구축이 완료되었습니다!");
    } catch (err) {
      console.error("본진 설정 실패:", err);
      if (err instanceof Error && err.message.includes("만료")) {
        if (window.confirm("구글 인증이 만료되었습니다. 다시 로그인하여 권한을 갱신할까요?")) {
          const url = buildGoogleAuthUrl(`${window.location.origin}/auth/callback`, true, { forceConsent: true });
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
      const allTeachers = (await readTeachersServerFirst()).teachers;
      for (const t of allTeachers) {
        if (t.email?.includes("@")) {
          await shareFolderWithEmail({ token: providerToken, fileId: targetId, email: t.email });
        }
      }
      window.alert("드라이브 ID 수동 지정 완료!");
      setManualDriveId("");
      setShowIdInput(false);
    } catch (err) {
      window.alert("지정 실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsBusy(false);
      setBatchProgress("");
    }
  };

  const handleResetDriveRoot = async () => {
    if (!window.confirm("본진 설정을 초기화할까요? (이미 배정된 학생 사물함은 유지됩니다)")) return;
    try {
      setIsBusy(true);
      await pushSharedSnapshot({ stateKv: { [SHARED_DRIVE_ROOT_ID_KEY]: "" } });
      setDriveRootId(null);
      window.alert("초기화 완료!");
    } catch (err) {
      window.alert("실패: " + (err instanceof Error ? err.message : "알 수 없는 오류"));
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <section className="mt-3 p-4 border border-red-200 rounded-2xl bg-red-50 relative">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-red-600 font-extrabold text-sm">🔥 구글 드라이브 본진 설정 (핵심)</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          className="px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-bold shadow-sm hover:bg-red-700 disabled:opacity-50"
          onClick={handleInitDriveRoot}
          disabled={isBusy}
        >
          {isBusy ? (batchProgress || "작업 중...") : "새 본진 드라이브 자동 구축"}
        </button>

        <button
          className="px-4 py-2 bg-white border border-red-200 text-red-700 rounded-xl text-xs font-bold shadow-sm hover:bg-red-100 disabled:opacity-50"
          onClick={() => setShowIdInput(true)}
          disabled={isBusy}
        >
          기존 폴더 ID로 직접 설정
        </button>

        {driveRootId && (
          <button
            className="px-4 py-2 bg-red-100 text-red-900 rounded-xl text-xs font-bold hover:bg-red-200"
            onClick={handleResetDriveRoot}
            disabled={isBusy}
          >
            본진 연결 끊기
          </button>
        )}
      </div>

      {driveRootId && (
        <div className="mt-4 p-3 bg-white border border-red-100 rounded-xl flex flex-col gap-1">
          <span className="text-[10px] text-red-500 font-bold uppercase tracking-wider">현재 연결된 폴더 ID</span>
          <div className="flex items-center gap-2">
            <code className="text-xs font-mono break-all text-gray-700 bg-gray-50 px-2 py-1 rounded border overflow-hidden">
              {driveRootId}
            </code>
            <button 
              className="text-[11px] text-blue-600 font-bold hover:underline whitespace-nowrap"
              onClick={() => {
                void navigator.clipboard.writeText(driveRootId);
                window.alert("ID가 복사되었습니다.");
              }}
            >복사</button>
          </div>
        </div>
      )}

      {/* ID 입력 모달 */}
      {showIdInput && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold mb-4">기존 구글 폴더 ID 입력</h3>
            <p className="text-sm text-gray-600 mb-4 leading-relaxed">
              사용하고 계신 구글 드라이브 폴더의 주소창에서 무작위 문자로 된 ID 값을 복사하여 붙여넣어 주세요.
            </p>
            <input
              className="w-full border rounded-xl px-4 py-3 text-sm font-mono mb-6 focus:ring-2 focus:ring-red-500 outline-none"
              placeholder="1A2b3C... 형태의 ID"
              value={manualDriveId}
              onChange={(e) => setManualDriveId(e.target.value)}
              autoFocus
            />
            <div className="flex gap-2">
              <button
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 disabled:opacity-50"
                onClick={handleManualSetDriveRoot}
                disabled={isBusy || !manualDriveId.trim()}
              >
                {isBusy ? "확인 중..." : "설정 완료"}
              </button>
              <button
                className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200"
                onClick={() => { setShowIdInput(false); setManualDriveId(""); }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {batchProgress && !showIdInput && (
        <div className="mt-3 p-3 bg-white border border-red-200 rounded-xl text-red-600 text-xs font-bold animate-pulse">
          ⏳ {batchProgress}
        </div>
      )}
    </section>
  );
}
