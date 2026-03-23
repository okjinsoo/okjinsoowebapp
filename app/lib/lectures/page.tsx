"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LectureLeafNode, LectureFolderNode } from "@/lib/types/index";
import {
  addFolderToTree,
  addLeafToFolder,
  createLectureLeaf,
  getFoldersFromTree,
  importLeafByCode,
  isLeaf,
  loadLectureTree,
  moveLeafInFolder,
  moveFolderInTree,
  patchLeafInTree,
  parseLectureTreeRaw,
  removeLeafFromFolder,
  removeFolderFromTree,
  renameFolderInTree,
  saveLectureTree,
  flattenLeaves,
} from "@/lib/storage/lectures";
import {
  pullSharedSnapshotAndHydrateWithOptions,
  pushSharedSnapshot,
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";
import { SHARED_LECTURE_TREE_KEY } from "@/lib/storage/sharedStateKeys";
import type { LectureTree } from "@/lib/types/index";

// [Phase 24.4] 클라우드 동기화 최적화: 자동 저장 제거 및 수동 저장 도입

function firstProblemUrl(leaf: LectureLeafNode): string {
  return leaf.problemUrls?.[0] ?? "";
}

export default function LecturesPage() {
  const [tree, setTree] = useState<LectureTree>(() => loadLectureTree());
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);

  const [newFolderTitle, setNewFolderTitle] = useState("");
  const [newLeafTitle, setNewLeafTitle] = useState("");
  const [importCode, setImportCode] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [copiedLeafId, setCopiedLeafId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderTitle, setEditingFolderTitle] = useState("");

  const [isDirty, setIsDirty] = useState(false);
  const [dbSyncing, setDbSyncing] = useState(false);
  const [dbSyncError, setDbSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // ===== 파생 상태 =====
  const folders = useMemo(() => getFoldersFromTree(tree), [tree]);
  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  );
  const leavesInFolder = useMemo(
    () => (selectedFolder?.children ?? []).filter(isLeaf) as LectureLeafNode[],
    [selectedFolder]
  );
  const selectedLeaf = useMemo(
    () => leavesInFolder.find((l) => l.leafId === selectedLeafId) ?? null,
    [leavesInFolder, selectedLeafId]
  );

  // ===== DB 동기화 =====
  async function loadFromRemoteSnapshot() {
    setDbSyncing(true);
    setDbSyncError(null);
    try {
      await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
      const localTree = loadLectureTree();
      setTree(localTree);

      const remoteRaw = await readRemoteSharedStateKvValue(SHARED_LECTURE_TREE_KEY);
      const remoteTree = parseLectureTreeRaw(remoteRaw);
      const localCount = flattenLeaves(localTree, { sortByOrderKey: false }).length;
      const remoteCount = flattenLeaves(remoteTree, { sortByOrderKey: false }).length;
      if (localCount > 0 && remoteCount === 0) {
        await pushSharedSnapshot({ stateKv: { [SHARED_LECTURE_TREE_KEY]: JSON.stringify(localTree) } });
      }
      setIsDirty(false);
    } catch (err) {
      console.error("강의 저장소 원격 불러오기 실패:", err);
      setDbSyncError("DB에서 강의 목록을 불러오지 못했어요.");
    } finally {
      setDbSyncing(false);
    }
  }

  async function pushTreeToDbNow(treeOverride?: LectureTree) {
    setDbSyncing(true);
    setDbSyncError(null);
    try {
      const targetTree = treeOverride ?? loadLectureTree();
      const result = await pushSharedSnapshot({
        stateKv: { [SHARED_LECTURE_TREE_KEY]: JSON.stringify(targetTree) },
      });
      if (!result.stateKvSynced) throw new Error("state_kv sync failed");
      setIsDirty(false);
      setLastSyncedAt(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("강의 저장소 원격 저장 실패:", err);
      setDbSyncError("DB 저장에 실패했어요.");
    } finally {
      setDbSyncing(false);
    }
  }

  function persistTree(next: LectureTree) {
    const saved = saveLectureTree(next);
    setTree(saved);
    setIsDirty(true);
    return saved;
  }

  useEffect(() => {
    const id = setTimeout(() => void loadFromRemoteSnapshot(), 0);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      clearTimeout(id);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);

  // ===== 폴더 핸들러 =====
  function handleAddFolder() {
    const title = newFolderTitle.trim();
    if (!title) { window.alert("폴더 제목을 입력해주세요."); return; }
    const next = addFolderToTree(tree, title);
    const saved = persistTree(next);
    const newFolder = getFoldersFromTree(saved).at(-1);
    if (newFolder) setSelectedFolderId(newFolder.id);
    setNewFolderTitle("");
  }

  function handleRemoveFolder() {
    if (!selectedFolder) return;
    const leafCount = (selectedFolder.children ?? []).filter(isLeaf).length;
    const msg = leafCount > 0
      ? `"${selectedFolder.title}" 폴더와 안에 있는 강의 ${leafCount}개를 모두 삭제할까요?`
      : `"${selectedFolder.title}" 폴더를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    persistTree(removeFolderFromTree(tree, selectedFolder.id));
    setSelectedFolderId(null);
    setSelectedLeafId(null);
  }

  function handleMoveFolder(offset: -1 | 1) {
    if (!selectedFolderId) return;
    persistTree(moveFolderInTree(tree, selectedFolderId, offset));
  }

  function startEditFolder(folder: LectureFolderNode) {
    setEditingFolderId(folder.id);
    setEditingFolderTitle(folder.title);
  }

  function commitEditFolder() {
    if (!editingFolderId || !editingFolderTitle.trim()) { setEditingFolderId(null); return; }
    persistTree(renameFolderInTree(tree, editingFolderId, editingFolderTitle.trim()));
    setEditingFolderId(null);
  }

  // ===== 강의 핸들러 =====
  function handleAddLeaf() {
    if (!selectedFolderId) return;
    const title = newLeafTitle.trim();
    if (!title) { window.alert("강의 제목을 입력해주세요."); return; }
    const leaf = createLectureLeaf({ title });
    const next = addLeafToFolder(tree, selectedFolderId, leaf);
    persistTree(next);
    setSelectedLeafId(leaf.leafId);
    setNewLeafTitle("");
  }

  function handleImportLeaf() {
    if (!selectedFolderId) return;
    const code = importCode.trim();
    if (!code) { window.alert("강의 고유 코드를 입력해주세요."); return; }
    const result = importLeafByCode(tree, selectedFolderId, code);
    if (!result) { window.alert("해당 코드의 강의를 찾지 못했습니다.\n강의 상세에서 '고유코드 복사' 버튼을 눌러 올바른 코드를 붙여넣어 주세요."); return; }
    persistTree(result.tree);
    setSelectedLeafId(result.newLeaf.leafId);
    setImportCode("");
    setShowImport(false);
  }

  function handlePatchLeaf(patch: { title?: string; lectureUrl?: string; problemUrl?: string }) {
    if (!selectedLeafId) return;
    const patchObj = {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.lectureUrl !== undefined ? { lectureUrl: patch.lectureUrl } : {}),
      ...(patch.problemUrl !== undefined ? { problemUrls: [patch.problemUrl] } : {}),
    };
    persistTree(patchLeafInTree(tree, selectedLeafId, patchObj));
  }

  function handleRemoveLeaf() {
    if (!selectedFolderId || !selectedLeaf) return;
    if (!window.confirm(`"${selectedLeaf.title || "제목 없는 강의"}" 강의를 삭제할까요?`)) return;
    const next = removeLeafFromFolder(tree, selectedFolderId, selectedLeaf.leafId);
    persistTree(next);
    const remaining = (getFoldersFromTree(next).find(f => f.id === selectedFolderId)?.children ?? []).filter(isLeaf);
    setSelectedLeafId((remaining[0] as LectureLeafNode | undefined)?.leafId ?? null);
  }

  function handleMoveLeaf(offset: -1 | 1) {
    if (!selectedFolderId || !selectedLeafId) return;
    persistTree(moveLeafInFolder(tree, selectedFolderId, selectedLeafId, offset));
  }

  function handleCopyLeafId(leafId: string) {
    void navigator.clipboard.writeText(leafId).then(() => {
      setCopiedLeafId(leafId);
      setTimeout(() => setCopiedLeafId(null), 2000);
    });
  }

  // ===== 스타일 상수 =====
  const surface = { borderColor: "var(--surface-border)", background: "var(--surface-bg)" };
  const headerStyle = { borderColor: "var(--surface-border)", background: "var(--surface-hover)" };

  return (
    <div className="p-6 space-y-6" style={{ maxWidth: 1100, margin: "0 auto" }}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">강의 저장소</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {dbSyncing ? "데이터 전송 중..." : dbSyncError ? dbSyncError : lastSyncedAt ? `마지막 클라우드 저장: ${lastSyncedAt}` : "수정 사항을 클라우드에 저장해주세요."}
          </p>
        </div>
        <button
          className={`px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-all flex items-center gap-2 ${
            isDirty ? "bg-blue-600 text-white hover:bg-blue-700 pulse-sync" : "bg-gray-100 text-gray-400 cursor-not-allowed"
          }`}
          onClick={() => isDirty && !dbSyncing && void pushTreeToDbNow()}
          disabled={!isDirty || dbSyncing}
        >
          {dbSyncing ? "🔄 저장 중..." : isDirty ? "☁️ 클라우드에 지금 저장" : "✅ 저장 완료"}
        </button>
      </header>

      {isDirty && (
        <div className="bg-orange-50 border border-orange-200 text-orange-800 px-4 py-2 rounded-lg text-xs flex items-center gap-2 animate-in fade-in slide-in-from-top-1">
          <span>⚠️ 아직 저장되지 않은 수정사항이 있습니다. 작업을 마치고 꼭 상단의 **[클라우드 저장]** 버튼을 눌러주세요.</span>
        </div>
      )}

      {/* ===== 폴더 섹션 (항상 표시) ===== */}
      <section className="space-y-3">
        {/* 폴더 추가 */}
        <div
          className="rounded-2xl border p-3 flex flex-wrap items-center gap-2"
          style={surface}
        >
          <input
            className="flex-1 min-w-[200px] rounded-lg border px-3 py-2 text-sm"
            value={newFolderTitle}
            onChange={(e) => setNewFolderTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); handleAddFolder(); } }}
            placeholder="새 폴더 제목"
          />
          <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={handleAddFolder}>
            폴더 추가
          </button>
        </div>

        {/* 폴더 목록 + 폴더 상세 */}
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* 폴더 목록 */}
          <section className="rounded-2xl border overflow-hidden" style={surface}>
            <div className="px-4 py-3 border-b text-sm font-semibold" style={headerStyle}>
              폴더 목록
            </div>
            <div className="max-h-[40vh] overflow-y-auto p-2 space-y-1">
              {folders.length === 0 ? (
                <div className="px-2 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                  폴더가 없습니다. 위에서 추가해주세요.
                </div>
              ) : (
                folders.map((folder) => {
                  const selected = folder.id === selectedFolderId;
                  const leafCount = (folder.children ?? []).filter(isLeaf).length;
                  return (
                    <button
                      key={folder.id}
                      className="w-full text-left rounded-lg px-3 py-2 border"
                      style={{
                        background: selected ? "var(--surface-selected-bg)" : "var(--surface-bg)",
                        borderColor: selected ? "var(--surface-selected-border)" : "transparent",
                      }}
                      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--surface-hover)"; }}
                      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "var(--surface-bg)"; }}
                      onClick={() => { setSelectedFolderId(folder.id); setSelectedLeafId(null); setShowImport(false); }}
                    >
                      <div className="font-medium truncate">📁 {folder.title}</div>
                      <div className="text-xs" style={{ color: "var(--text-muted)" }}>강의 {leafCount}개</div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* 폴더 상세 */}
          <section className="rounded-2xl border p-4 space-y-4" style={surface}>
            <div className="text-sm font-semibold">폴더 상세</div>
            {!selectedFolder ? (
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>왼쪽에서 폴더를 선택하세요.</div>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs" style={{ color: "var(--text-muted)" }}>폴더 이름</label>
                  {editingFolderId === selectedFolder.id ? (
                    <div className="flex gap-2">
                      <input
                        className="flex-1 rounded-lg border px-3 py-2 text-sm"
                        value={editingFolderTitle}
                        onChange={(e) => setEditingFolderTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEditFolder(); }}
                        autoFocus
                      />
                      <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={commitEditFolder}>저장</button>
                      <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => setEditingFolderId(null)}>취소</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{selectedFolder.title}</span>
                      <button
                        className="px-2 py-1 rounded border text-xs btn-white"
                        onClick={() => startEditFolder(selectedFolder)}
                      >수정</button>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => handleMoveFolder(-1)}>위로</button>
                  <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => handleMoveFolder(1)}>아래로</button>
                  <button className="px-3 py-2 rounded-lg border text-sm text-red-600 btn-white" onClick={handleRemoveFolder}>삭제</button>
                </div>
              </>
            )}
          </section>
        </div>
      </section>

      {/* ===== 강의 섹션 (폴더 선택 시만 표시) ===== */}
      {selectedFolder && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1" style={{ background: "var(--surface-border)" }} />
            <span className="text-xs px-2" style={{ color: "var(--text-muted)" }}>
              📁 {selectedFolder.title} 안의 강의
            </span>
            <div className="h-px flex-1" style={{ background: "var(--surface-border)" }} />
          </div>

          {/* 강의 추가 + 불러오기 */}
          <div className="rounded-2xl border p-3 space-y-2" style={surface}>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="flex-1 min-w-[200px] rounded-lg border px-3 py-2 text-sm"
                value={newLeafTitle}
                onChange={(e) => setNewLeafTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); handleAddLeaf(); } }}
                placeholder="새 강의 제목"
              />
              <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={handleAddLeaf}>
                강의 추가
              </button>
              <button
                className="px-3 py-2 rounded-lg border text-sm btn-white"
                onClick={() => setShowImport((v) => !v)}
              >
                {showImport ? "취소" : "강의 불러오기"}
              </button>
            </div>

            {showImport && (
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--surface-border)" }}>
                <input
                  className="flex-1 min-w-[240px] rounded-lg border px-3 py-2 text-sm font-mono"
                  value={importCode}
                  onChange={(e) => setImportCode(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleImportLeaf(); }}
                  placeholder="강의 고유 코드 붙여넣기…"
                  autoFocus
                />
                <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={handleImportLeaf}>불러오기</button>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  다른 폴더 강의 상세에서 &apos;고유코드 복사&apos; 버튼을 누른 후 붙여넣으세요.
                </span>
              </div>
            )}
          </div>

          {/* 강의 목록 + 강의 상세 */}
          <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            {/* 강의 목록 */}
            <section className="rounded-2xl border overflow-hidden" style={surface}>
              <div className="px-4 py-3 border-b text-sm font-semibold" style={headerStyle}>
                강의 목록 ({leavesInFolder.length}개)
              </div>
              <div className="max-h-[50vh] overflow-y-auto p-2 space-y-1">
                {leavesInFolder.length === 0 ? (
                  <div className="px-2 py-3 text-sm" style={{ color: "var(--text-muted)" }}>
                    이 폴더에 강의가 없습니다.
                  </div>
                ) : (
                  leavesInFolder.map((leaf, idx) => {
                    const selected = leaf.leafId === selectedLeafId;
                    return (
                      <button
                        key={leaf.leafId}
                        className="w-full text-left rounded-lg px-3 py-2 border"
                        style={{
                          background: selected ? "var(--surface-selected-bg)" : "var(--surface-bg)",
                          borderColor: selected ? "var(--surface-selected-border)" : "transparent",
                        }}
                        onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--surface-hover)"; }}
                        onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "var(--surface-bg)"; }}
                        onClick={() => setSelectedLeafId(leaf.leafId)}
                      >
                        <div className="text-xs" style={{ color: "var(--text-muted)" }}>#{idx + 1}</div>
                        <div className="font-medium truncate">{leaf.title || "제목 없는 강의"}</div>
                        <div className="text-xs truncate" style={{ color: "var(--text-muted)" }}>{leaf.lectureUrl || "강의 링크 없음"}</div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {/* 강의 상세 */}
            <section className="rounded-2xl border p-4 space-y-4" style={surface}>
              <div className="text-sm font-semibold">강의 상세</div>
              {!selectedLeaf ? (
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>왼쪽에서 강의를 선택해주세요.</div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs" style={{ color: "var(--text-muted)" }}>강의 제목</label>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={selectedLeaf.title}
                      onChange={(e) => handlePatchLeaf({ title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs" style={{ color: "var(--text-muted)" }}>강의 URL</label>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={selectedLeaf.lectureUrl ?? ""}
                      onChange={(e) => handlePatchLeaf({ lectureUrl: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs" style={{ color: "var(--text-muted)" }}>문제 URL</label>
                    <input
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      value={firstProblemUrl(selectedLeaf)}
                      onChange={(e) => handlePatchLeaf({ problemUrl: e.target.value })}
                      placeholder="https://..."
                    />
                  </div>

                  {/* 고유코드 */}
                  <div className="space-y-1">
                    <label className="text-xs" style={{ color: "var(--text-muted)" }}>고유 코드 (다른 폴더에 불러오기용)</label>
                    <div className="flex items-center gap-2">
                      <code
                        className="flex-1 text-xs px-3 py-2 rounded-lg border font-mono truncate"
                        style={{ background: "var(--surface-hover)", borderColor: "var(--surface-border)" }}
                      >
                        {selectedLeaf.leafId}
                      </code>
                      <button
                        className="px-3 py-2 rounded-lg border text-xs btn-white whitespace-nowrap"
                        onClick={() => handleCopyLeafId(selectedLeaf.leafId)}
                      >
                        {copiedLeafId === selectedLeaf.leafId ? "복사됨 ✓" : "고유코드 복사"}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => handleMoveLeaf(-1)}>위로</button>
                    <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => handleMoveLeaf(1)}>아래로</button>
                    <button className="px-3 py-2 rounded-lg border text-sm text-red-600 btn-white" onClick={handleRemoveLeaf}>삭제</button>
                  </div>

                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    수정 내용은 자동 저장되며, 회차 상세의 &quot;강의 추가&quot; 목록에 바로 반영됩니다.
                  </div>
                </>
              )}
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
