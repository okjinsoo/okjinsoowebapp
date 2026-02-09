"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LectureFolderNode, LectureLeafNode, LectureNode, LectureTree } from "@/lib/types/index";
import {
  addFolder,
  addLeaf,
  deleteNode,
  findFolderById,
  loadLectureTree,
  reorderChildren,
  saveLectureTree,
  saveLectureTreeWithReindex,
  updateLeafLinks,
  updateNodeTitle,
} from "@/lib/storage/lectures";

type DragPayload = {
  parentFolderId: string;
  nodeId: string;
};

type Selection = { id: string; title: string; lectureUrl: string; problem0: string } | null;

type Draft = { title: string; lectureUrl: string; problem0: string } | null;

const DRAG_MIME = "application/x-lecture-node";

function parseDragPayload(raw: string | null, fallback: DragPayload | null): DragPayload | null {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<DragPayload>;
    if (typeof parsed.parentFolderId !== "string") return fallback;
    if (typeof parsed.nodeId !== "string") return fallback;
    return { parentFolderId: parsed.parentFolderId, nodeId: parsed.nodeId };
  } catch {
    return fallback;
  }
}

function cloneTree(t: LectureTree): LectureTree {
  return JSON.parse(JSON.stringify(t)) as LectureTree;
}

function ensureLeaf(x: LectureNode): LectureLeafNode {
  if (x.type !== "leaf") throw new Error("Not a leaf");
  return x as LectureLeafNode;
}

function buildFolderPathMap(root: LectureFolderNode): Map<string, string[]> {
  const map = new Map<string, string[]>();
  function walk(node: LectureFolderNode, path: string[]) {
    map.set(node.id, path);
    for (const child of node.children) {
      if (child.type === "folder") {
        walk(child as LectureFolderNode, [...path, child.id]);
      }
    }
  }
  walk(root, [root.id]);
  return map;
}

function MiniTree(props: {
  node: LectureFolderNode;
  depth: number;
  currentId: string;
  pathMap: Map<string, string[]>;
  onNavigate: (path: string[]) => void;
}) {
  const { node, depth, currentId, pathMap, onNavigate } = props;
  const path = pathMap.get(node.id) ?? [node.id];
  const isCurrent = node.id === currentId;

  return (
    <div>
      <button
        className={`block w-full text-left rounded px-2 py-1 text-xs ${
          isCurrent ? "bg-neutral-200" : "hover:bg-neutral-100"
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => onNavigate(path)}
      >
        DIR {node.title}
      </button>
      <div>
        {node.children
          .filter((c) => c.type === "folder")
          .map((child) => (
            <MiniTree
              key={child.id}
              node={child as LectureFolderNode}
              depth={depth + 1}
              currentId={currentId}
              pathMap={pathMap}
              onNavigate={onNavigate}
            />
          ))}
      </div>
    </div>
  );
}

export default function LecturesPage() {
  const [tree, setTree] = useState<LectureTree | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [path, setPath] = useState<string[]>([]);
  const [historyState, setHistoryState] = useState<{ stack: string[][]; index: number }>({
    stack: [],
    index: -1,
  });

  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<Draft>(null);
  const [quickType, setQuickType] = useState<"folder" | "leaf">("folder");
  const [quickTitle, setQuickTitle] = useState("");

  // 편집 시작 시점 스냅샷(취소 시 롤백)
  const [editSnapshot, setEditSnapshot] = useState<LectureTree | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      const t = loadLectureTree();
      setTree(t);
      setPath([t.root.id]); // 루트부터 시작
      setHistoryState({ stack: [[t.root.id]], index: 0 });
    }, 0);
    return () => clearTimeout(id);
  }, []);

  function samePath(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function goToPath(next: string[]) {
    setPath(next);
    setHistoryState((prev) => {
      const trimmed = prev.stack.slice(0, prev.index + 1);
      const last = trimmed[trimmed.length - 1];
      if (last && samePath(last, next)) return prev;
      const nextStack = [...trimmed, next];
      return { stack: nextStack, index: nextStack.length - 1 };
    });
  }

  const canBack = historyState.index > 0;
  const canForward = historyState.index + 1 < historyState.stack.length;

  function goBack() {
    setHistoryState((prev) => {
      if (prev.index <= 0) return prev;
      const idx = prev.index - 1;
      const nextPath = prev.stack[idx];
      setPath(nextPath);
      return { ...prev, index: idx };
    });
  }

  function goForward() {
    setHistoryState((prev) => {
      if (prev.index + 1 >= prev.stack.length) return prev;
      const idx = prev.index + 1;
      const nextPath = prev.stack[idx];
      setPath(nextPath);
      return { ...prev, index: idx };
    });
  }

  const columns = useMemo(() => {
    if (!tree) return [] as LectureFolderNode[];
    const ids = path.length > 0 ? path : [tree.root.id];
    const nodes = ids
      .map((id) => findFolderById(tree, id))
      .filter((x): x is LectureFolderNode => Boolean(x));
    return nodes.slice(-4);
  }, [tree, path]);

  const breadcrumb = useMemo(() => {
    if (!tree) return [] as LectureFolderNode[];
    return path
      .map((id) => findFolderById(tree, id))
      .filter((x): x is LectureFolderNode => Boolean(x));
  }, [tree, path]);

  const currentFolder = columns[columns.length - 1] ?? null;
  const folderPathMap = useMemo(() => {
    if (!tree) return new Map<string, string[]>();
    return buildFolderPathMap(tree.root);
  }, [tree]);
  const baseDepth = Math.max(0, path.length - columns.length);

  function setSelectionFromNode(node: LectureNode) {
    if (node.type === "folder") return;
    const leaf = ensureLeaf(node);
    const problem0 = (leaf.problemUrls?.[0] ?? "").trim();
    const nextSel: Selection = {
      id: leaf.id,
      title: leaf.title,
      lectureUrl: (leaf.lectureUrl ?? "").trim(),
      problem0,
    };
    setSelection(nextSel);
    setDraft({ title: nextSel.title, lectureUrl: nextSel.lectureUrl, problem0 });
  }

  function isDirty(): boolean {
    if (!selection || !draft) return false;
    return (
      selection.title !== draft.title ||
      selection.lectureUrl !== draft.lectureUrl ||
      selection.problem0 !== draft.problem0
    );
  }

  function saveDraft(): boolean {
    if (!tree || !selection || !draft) return false;
    if (!isDirty()) return true;

    const nextTitle = updateNodeTitle(tree, selection.id, draft.title);
    const next = updateLeafLinks(nextTitle, selection.id, {
      lectureUrl: draft.lectureUrl,
      problemUrls: [draft.problem0],
    });
    const saved = saveLectureTree(next);
    setTree(saved);
    setSelection({ ...selection, title: draft.title, lectureUrl: draft.lectureUrl, problem0: draft.problem0 });
    return true;
  }

  function cancelDraft() {
    if (!selection) return;
    setDraft({
      title: selection.title,
      lectureUrl: selection.lectureUrl,
      problem0: selection.problem0,
    });
  }

  function autoSaveBeforeMove(action: () => void) {
    if (isDirty()) {
      const saved = saveDraft();
      if (!saved) return;
    }
    action();
  }

  const startEdit = () => {
    if (!tree) return;
    setEditSnapshot(cloneTree(tree));
    setEditMode(true);
  };

  const cancelEdit = () => {
    if (!editSnapshot) {
      setEditMode(false);
      return;
    }
    setTree(cloneTree(editSnapshot));
    setEditMode(false);
    setEditSnapshot(null);
    setDragging(null);
  };

  const saveEdit = () => {
    if (!tree) return;
    const saved = saveLectureTreeWithReindex(tree);
    setTree(saved);
    setEditMode(false);
    setEditSnapshot(null);
    setDragging(null);
  };

  const onAddFolder = (parentFolderId: string, title: string) => {
    if (!tree) return;
    const trimmed = title.trim();
    if (!trimmed) {
      window.alert("폴더 이름을 입력해주세요.");
      return;
    }
    const next = addFolder(tree, parentFolderId, trimmed);
    setTree(next);
  };

  const onAddLeaf = (parentFolderId: string, title: string) => {
    if (!tree) return;
    const trimmed = title.trim();
    if (!trimmed) {
      window.alert("강의 제목을 입력해주세요.");
      return;
    }
    const next = addLeaf(tree, parentFolderId, {
      title: trimmed,
      lectureUrl: "",
      problemUrls: [""],
    });
    setTree(next);
    const parent = findFolderById(next, parentFolderId);
    const created = parent?.children.filter((c) => c.type === "leaf").slice(-1)[0] ?? null;
    if (created && created.type === "leaf") {
      setSelectionFromNode(created);
    }
    setQuickTitle("");
  };

  const onDeleteNode = (nodeId: string) => {
    if (!tree) return;

    // ✅ 루트 삭제 금지
    if (nodeId === tree.root.id) {
      window.alert("루트 폴더는 삭제할 수 없습니다.");
      return;
    }

    const ok = window.confirm("정말 삭제할까요? (하위 폴더/강의도 함께 삭제됩니다)");
    if (!ok) return;
    const next = deleteNode(tree, nodeId);
    setTree(next);
    if (selection?.id === nodeId) {
      setSelection(null);
      setDraft(null);
    }
  };

  // ---- Drag & Drop (같은 폴더의 children 안에서만) ----

  const onDragStartNode = (parentFolderId: string, nodeId: string, e: React.DragEvent) => {
    if (!editMode) return;
    const payload: DragPayload = { parentFolderId, nodeId };
    setDragging(payload);
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!editMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onDropOnChild = (parentFolderId: string, targetNodeId: string, e: React.DragEvent) => {
    if (!editMode || !tree) return;
    e.preventDefault();

    const payload = parseDragPayload(e.dataTransfer.getData(DRAG_MIME), dragging);
    if (!payload) return;

    // 같은 parent 폴더에서만 이동 허용
    if (payload.parentFolderId !== parentFolderId) return;
    if (payload.nodeId === targetNodeId) return;

    const parent = findFolderById(tree, parentFolderId);
    if (!parent) return;

    const ids = parent.children.map((c) => c.id);
    const fromIdx = ids.indexOf(payload.nodeId);
    const toIdx = ids.indexOf(targetNodeId);
    if (fromIdx < 0 || toIdx < 0) return;

    // payload.nodeId를 제거한 뒤 target 위치 앞에 삽입
    const nextIds = ids.filter((id) => id !== payload.nodeId);
    const insertAt = nextIds.indexOf(targetNodeId);
    nextIds.splice(insertAt, 0, payload.nodeId);

    const nextTree = reorderChildren(tree, parentFolderId, nextIds);
    setTree(nextTree);
  };

  const onDropOnFolderEnd = (parentFolderId: string, e: React.DragEvent) => {
    if (!editMode || !tree) return;
    e.preventDefault();

    const payload = parseDragPayload(e.dataTransfer.getData(DRAG_MIME), dragging);
    if (!payload) return;

    if (payload.parentFolderId !== parentFolderId) return;

    const parent = findFolderById(tree, parentFolderId);
    if (!parent) return;

    const ids = parent.children.map((c) => c.id);
    const fromIdx = ids.indexOf(payload.nodeId);
    if (fromIdx < 0) return;

    const nextIds = ids.filter((id) => id !== payload.nodeId);
    nextIds.push(payload.nodeId);

    const nextTree = reorderChildren(tree, parentFolderId, nextIds);
    setTree(nextTree);
  };

  if (!tree) {
    return (
      <div className="p-6">
        <div className="text-sm text-neutral-600">강의 저장소를 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">강의 저장소</h1>
          <p className="text-sm text-neutral-600">
            Finder 계층(열) 방식으로 폴더를 열어 관리합니다. (편집 모드에서만 수정/정렬 가능)
          </p>
          <div className="mt-2 text-sm text-neutral-600">
            {breadcrumb.map((f, idx) => (
              <span key={`${f.id}:${idx}`}>
                <button
                  className="underline underline-offset-2"
                  onClick={() =>
                    autoSaveBeforeMove(() => {
                      const next = breadcrumb.slice(0, idx + 1).map((x) => x.id);
                      goToPath(next);
                    })
                  }
                  disabled={idx === breadcrumb.length - 1}
                >
                  {f.title}
                </button>
                {idx < breadcrumb.length - 1 ? " / " : ""}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 rounded border text-xs hover:bg-neutral-50 disabled:opacity-50"
            onClick={() => autoSaveBeforeMove(goBack)}
            disabled={!canBack}
          >
            ← 뒤로
          </button>
          <button
            className="px-2 py-1 rounded border text-xs hover:bg-neutral-50 disabled:opacity-50"
            onClick={() => autoSaveBeforeMove(goForward)}
            disabled={!canForward}
          >
            앞으로 →
          </button>
          {!editMode ? (
            <button className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50" onClick={startEdit}>
              편집
            </button>
          ) : (
            <>
              <button className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50" onClick={cancelEdit}>
                취소
              </button>
              <button className="px-3 py-2 rounded-lg bg-black text-white text-sm hover:opacity-90" onClick={saveEdit}>
                저장 (orderKey 재부여)
              </button>
            </>
          )}
        </div>
      </header>

      <div className="rounded-2xl border p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-sm font-semibold">
            현재 폴더: <span className="text-neutral-700">{currentFolder?.title ?? "-"}</span>
          </div>
          <div className="flex items-center gap-2">
            {path.length > 1 ? (
              <button
                className="px-2 py-1 rounded border text-xs hover:bg-neutral-50"
                onClick={() => autoSaveBeforeMove(() => goToPath(path.slice(0, -1)))}
              >
                상위로
              </button>
            ) : null}
            {path[0] ? (
              <button
                className="px-2 py-1 rounded border text-xs hover:bg-neutral-50"
                onClick={() => autoSaveBeforeMove(() => goToPath([path[0]]))}
              >
                루트로
              </button>
            ) : null}
            {editMode && currentFolder ? (
              <>
                <div className="flex items-center gap-1">
                  <select
                    className="rounded border px-2 py-1 text-xs"
                    value={quickType}
                    onChange={(e) => setQuickType(e.target.value === "folder" ? "folder" : "leaf")}
                  >
                    <option value="folder">폴더</option>
                    <option value="leaf">강의</option>
                  </select>
                  <input
                    className="rounded border px-2 py-1 text-xs"
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    placeholder={quickType === "folder" ? "폴더 이름" : "강의 제목"}
                  />
                  <button
                    className="px-2 py-1 rounded border text-xs hover:bg-neutral-50"
                    onClick={() => {
                      if (quickType === "folder") onAddFolder(currentFolder.id, quickTitle);
                      else onAddLeaf(currentFolder.id, quickTitle);
                    }}
                  >
                    생성
                  </button>
                </div>
                {currentFolder.id !== tree.root.id ? (
                  <button
                    className="px-2 py-1 rounded border text-xs hover:bg-neutral-50"
                    onClick={() => onDeleteNode(currentFolder.id)}
                    title="폴더 삭제"
                  >
                    삭제
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="flex gap-2">
          <div className="min-w-[220px] max-w-[240px] rounded-xl border p-2 overflow-y-auto" style={{ maxHeight: 520 }}>
            <div className="text-xs font-semibold text-neutral-600 mb-2">폴더 트리</div>
            {tree ? (
              <MiniTree
                node={tree.root}
                depth={0}
                currentId={currentFolder?.id ?? ""}
                pathMap={folderPathMap}
                onNavigate={(nextPath) => autoSaveBeforeMove(() => goToPath(nextPath))}
              />
            ) : null}
          </div>

          <div className="flex gap-2 overflow-x-auto">
            {columns.map((folder, idx) => {
              const depthIndex = baseDepth + idx;
              return (
                <div key={`${folder.id}:${idx}`} className="min-w-[240px] rounded-xl border p-2">
                  <div className="text-xs font-semibold text-neutral-600 mb-2">{folder.title}</div>
                  <div className="space-y-1">
                    {folder.children.length === 0 ? (
                      <div className="text-xs text-neutral-500">비어 있습니다.</div>
                    ) : null}

                    {folder.children.map((child) => {
                      const isFolder = child.type === "folder";
                      const isSelected = !isFolder && selection?.id === child.id;

                      return (
                        <div
                          key={child.id}
                          className={
                            "flex items-center justify-between gap-2 rounded-lg border px-2 py-2 cursor-pointer " +
                            (isSelected ? "bg-neutral-100" : "bg-white")
                          }
                          onDragOver={onDragOver}
                          onDrop={(e) => onDropOnChild(folder.id, child.id, e)}
                          title={editMode ? "같은 폴더 안에서만 정렬됩니다." : undefined}
                          onClick={() =>
                            autoSaveBeforeMove(() => {
                              if (child.type === "folder") {
                                setSelection(null);
                                setDraft(null);
                                goToPath([...path.slice(0, depthIndex + 1), child.id]);
                                return;
                              }
                              setSelectionFromNode(child);
                            })
                          }
                        >
                          <div className="flex items-center gap-2">
                            {editMode ? (
                              <button
                                type="button"
                                className="w-6 h-6 rounded border text-xs hover:bg-neutral-50 cursor-grab active:cursor-grabbing"
                                draggable
                                onDragStart={(e) => onDragStartNode(folder.id, child.id, e)}
                                title="드래그해서 순서를 바꾸세요"
                                onClick={(e) => e.stopPropagation()}
                              >
                                ≡
                              </button>
                            ) : null}

                            <span className="text-[11px] rounded border px-1 py-0.5 text-neutral-600">
                              {isFolder ? "DIR" : "LEC"}
                            </span>

                            <span className="text-left text-sm">{child.title}</span>
                          </div>

                          {editMode ? (
                            <button
                              className="text-xs text-neutral-500 hover:text-neutral-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteNode(child.id);
                              }}
                            >
                              삭제
                            </button>
                          ) : null}
                        </div>
                      );
                    })}

                    {editMode ? (
                      <div
                        className="rounded-lg border border-dashed p-2 text-xs text-neutral-500"
                        onDragOver={onDragOver}
                        onDrop={(e) => onDropOnFolderEnd(folder.id, e)}
                      >
                        여기로 드롭하면 맨 아래로 이동
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

          <div className="min-w-[280px] rounded-xl border p-3">
            <div className="text-xs font-semibold text-neutral-600 mb-2">편집 패널</div>
            {selection && draft ? (
              <div className="space-y-3">
                <div className="text-sm font-semibold">
                  강의 편집
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">제목</div>
                  <input
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    value={draft.title}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDraft({ ...draft, title: v });
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">강의 URL</div>
                  <input
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    value={draft.lectureUrl}
                    onChange={(e) => setDraft({ ...draft, lectureUrl: e.target.value })}
                    placeholder="https://..."
                  />
                </div>

                <div className="space-y-1">
                  <div className="text-xs text-neutral-600">문제 URL (1)</div>
                  <input
                    className="w-full px-3 py-2 rounded-lg border text-sm"
                    value={draft.problem0}
                    onChange={(e) => setDraft({ ...draft, problem0: e.target.value })}
                    placeholder="https://..."
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    className="px-3 py-2 rounded-lg bg-black text-white text-sm hover:opacity-90"
                    onClick={saveDraft}
                    disabled={!isDirty()}
                  >
                    저장
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50"
                    onClick={cancelDraft}
                    disabled={!isDirty()}
                  >
                    취소
                  </button>
                  {isDirty() ? (
                    <span className="text-xs text-neutral-500">저장하지 않은 변경이 있습니다.</span>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="text-sm text-neutral-500">강의를 선택하세요.</div>
            )}
          </div>
        </div>
      </div>

      </div>

      <footer className="text-xs text-neutral-500">
        • 회차에는 leafId만 저장합니다. • 정렬은 폴더 단위(children)에서만 가능합니다. • 저장 시 전체 leaf에
        orderKey가 000001부터 재부여됩니다.
      </footer>

    </div>
  );
}
