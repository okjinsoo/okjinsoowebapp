"use client";

import { useEffect, useState, useRef } from "react";
import { 
  ensurePath, 
  uploadToDrive, 
  listFiles, 
  deleteFileFromDrive, 
  DriveFile 
} from "@/lib/integrations/googleDriveSync";
import { loadAuthSession } from "@/lib/auth/supabaseAuth";
import {
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";
import { SHARED_DRIVE_ROOT_ID_KEY } from "@/lib/storage/sharedStateKeys";
import type { Student } from "@/lib/types/index";
import {
  readStudentContextServerRequired,
  readStudentsServerRequired,
} from "@/lib/storage/serverRead";

type Props = {
  open: boolean;
  token: string;
  sessionIndex: number;
  contentTitle: string;
  submitType: "필기 제출" | "풀이 제출";
  initialValue: string; 
  rootFolderId?: string | null; // 부모가 이미 알고 있는 본진 ID
  onClose: () => void;
  onComplete: (driveLink: string) => void;
};

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function hasDriveFolderId(student: Student | null | undefined): student is Student {
  return Boolean((student?.driveFolderId ?? "").trim());
}

function pickBestStudentByEmail(students: Student[], email: string): Student | null {
  const matched = students.filter((student) => normalizeEmail(student.googleEmail) === email);
  if (matched.length === 0) return null;

  const activeWithLocker = matched.find((student) => student.status === "active" && hasDriveFolderId(student));
  if (activeWithLocker) return activeWithLocker;

  const withLocker = matched.find((student) => hasDriveFolderId(student));
  if (withLocker) return withLocker;

  const active = matched.find((student) => student.status === "active");
  return active ?? matched[0] ?? null;
}

export default function DriveUploadModal({
  open,
  token,
  sessionIndex,
  contentTitle,
  submitType,
  rootFolderId,
  onClose,
  onComplete,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // 모달 열릴 때 초기화 및 폴더 준비
  useEffect(() => {
    if (!open) return;
    
    setLoading(true);
    setError("");
    
    void (async () => {
      try {
        const context = await readStudentContextServerRequired(token);
        const student = context.student;
        if (!student) throw new Error("학생 정보를 찾을 수 없습니다.");

        const auth = loadAuthSession();
        const providerToken = auth?.providerAccessToken;
        if (!providerToken) throw new Error("구글 드라이브 연결 권한이 없습니다. 다시 로그인 해주세요.");

        // 최신 학생 목록을 서버 우선으로 다시 조회 (사물함 배정 직후 반영용)
        const allStudents = await readStudentsServerRequired();
        const latestStudentById = allStudents.find((row) => row.id === student.id);
        const latestStudentByToken = allStudents.find((row) => row.token === token);
        const loginEmail = normalizeEmail(auth?.email);
        const emailMatchedStudent = loginEmail ? pickBestStudentByEmail(allStudents, loginEmail) : null;

        const candidateStudents = [latestStudentById, latestStudentByToken, emailMatchedStudent, student];
        const bestCandidate = candidateStudents.find((row) => hasDriveFolderId(row)) ?? null;
        const effectiveDriveFolderId = bestCandidate?.driveFolderId ?? "";

        if (!effectiveDriveFolderId) {
          throw new Error("원장님이 사물함을 아직 배정하지 않았습니다. 원장님께 [학생 사물함 일괄 정비]를 요청해 주세요.");
        }

        // 1. 본진 ID 확보 (부모가 없으면 직접 fetch)
        let effectiveRootId = rootFolderId;
        if (!effectiveRootId) {
          effectiveRootId = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
        }

        // 2. 폴더 경로 확보 (공장 가동!)
        // 학생이 이미 개인 사물함 ID를 가지고 있다면(원장님이 사물함을 정비했다면) 그것을 최우선으로 사용
        const fid = await ensurePath({
          token: providerToken,
          sessionIndex,
          contentTitle,
          submitType,
          startStudentFolderId: effectiveDriveFolderId
        });
        setFolderId(fid);

        // 2. 기존 파일 목록 불러오기
        const existingFiles = await listFiles({ token: providerToken, folderId: fid });
        setFiles(existingFiles);

      } catch (err) {
        console.error("Drive 초기화 실패:", err);
        setError(err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, token, sessionIndex, contentTitle, submitType, rootFolderId]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0 || !folderId) return;

    const auth = loadAuthSession();
    const providerToken = auth?.providerAccessToken;
    if (!providerToken) return;

    setUploading(true);
    setError("");

    try {
      // 한 장씩 순차 업로드
      for (const file of Array.from(selectedFiles)) {
        await uploadToDrive({
          token: providerToken,
          folderId,
          file,
        });
      }
      
      // 목록 새로고침
      const nextFiles = await listFiles({ token: providerToken, folderId });
      setFiles(nextFiles);
    } catch {
      setError("업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!window.confirm("이 파일을 삭제할까요?")) return;
    
    const auth = loadAuthSession();
    const providerToken = auth?.providerAccessToken;
    if (!providerToken) return;

    try {
      await deleteFileFromDrive({ token: providerToken, fileId });
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    }
  };

  const handleFinalSubmit = () => {
    if (files.length === 0) {
      window.alert("제출할 사진이나 파일이 없습니다.");
      return;
    }
    
    if (!window.confirm("모든 사진을 올리셨나요? 제출 완료 후에는 수정이 불가능합니다.")) return;

    // 폴더 링크를 제출 URL로 전달 (또는 첫 번째 파일 링크)
    // 원장님께서는 폴더를 보는 편이 좋으므로 폴더 접근 주소를 생성
    // 구글 드라이브 폴더 주소 형식: https://drive.google.com/drive/folders/{folderId}
    const folderLink = `https://drive.google.com/drive/folders/${folderId}`;
    onComplete(folderLink);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl animate-in zoom-in-95 duration-200">
        {/* 헤더 */}
        <div className="bg-neutral-50 p-6 border-b border-neutral-100">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-neutral-900">{submitType}</h3>
              <p className="text-sm text-neutral-500 mt-1">{contentTitle}</p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-full hover:bg-neutral-200 transition-colors"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>

        {/* 본문 */}
        <div className="p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-10 h-10 border-4 border-black/10 border-t-black rounded-full animate-spin"></div>
              <p className="mt-4 text-neutral-500 font-medium">드라이브 연결 중...</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-red-50 p-4 text-red-600 text-sm border border-red-100">
              <p className="font-semibold">오류 발생</p>
              <p>{error}</p>
              {error.includes("만료") && (
                <p className="mt-2 font-bold text-red-800">
                  ⚠️ 홈 화면에서 &apos;구글 권한 다시 연결&apos;을 눌러 Drive 권한을 다시 연결해 주세요.
                </p>
              )}
              <button 
                onClick={onClose}
                className="mt-3 font-bold underline"
              >
                닫기
              </button>
            </div>
          ) : (
            <div className="grid gap-6">
              {/* 업로드된 파일 목록 */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-bold text-neutral-700">업로드 완료 ({files.length}장)</span>
                </div>
                
                {files.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed border-neutral-200 py-10 flex flex-col items-center justify-center text-neutral-400">
                    <p className="text-sm">올라온 파일이 없습니다.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    {files.map(file => (
                      <div key={file.id} className="group flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50 p-3">
                        <div className="flex-1 truncate mr-3 text-sm font-medium text-black">
                          {file.name}
                        </div>
                        <button 
                          onClick={() => handleDelete(file.id)}
                          className="p-1 hover:bg-neutral-200 rounded-full transition-colors text-red-500"
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 액션 버튼 */}
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={uploading}
                  className="py-5 rounded-2xl border border-neutral-200 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                >
                  <span className="text-base font-black text-black">사진 찍기</span>
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment" 
                    ref={cameraInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                </button>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="py-5 rounded-2xl border border-neutral-200 hover:bg-neutral-50 transition-colors disabled:opacity-50"
                >
                  <span className="text-base font-black text-black">파일 선택</span>
                  <input 
                    type="file" 
                    multiple 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload} 
                  />
                </button>
              </div>

              {uploading && (
                <div className="flex items-center gap-3 py-2 animate-pulse">
                  <div className="w-5 h-5 border-3 border-black/10 border-t-black rounded-full animate-spin"></div>
                  <span className="text-sm font-bold text-black">업로드 중...</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div className="p-6 bg-neutral-50 border-t border-neutral-100">
          <button 
            onClick={handleFinalSubmit}
            disabled={loading || uploading || files.length === 0}
            className="w-full py-4 rounded-2xl bg-black text-white font-bold text-lg shadow-lg active:scale-[0.98] transition-all disabled:bg-neutral-300 disabled:shadow-none"
          >
            제출 완료하기
          </button>
          <p className="text-[11px] text-neutral-400 text-center mt-3 leading-tight">
            ※ 제출 완료 후에는 사진 추가나 삭제가 불가능합니다.<br/>
            신중하게 확인 후 버튼을 눌러주세요.
          </p>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
      `}} />
    </div>
  );
}
