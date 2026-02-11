"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { LectureFolderNode, LectureLeafNode, LectureTree } from "@/lib/types/index";
import {
  addFolder,
  addLeaf,
  deleteNode,
  findFolderById,
  findNodeById,
  loadLectureTree,
  saveLectureTreeWithReindex,
  updateLeafLinks,
  updateNodeTitle,
} from "@/lib/storage/lectures";

type Selection = { id: string; title: string; lectureUrl: string; problem0: string } | null;
type Draft = { title: string; lectureUrl: string; problem0: string } | null;
type LeafRow = { leaf: LectureLeafNode; pathLabel: string };

function cloneTree(t: LectureTree): LectureTree {
  return JSON.parse(JSON.stringify(t)) as LectureTree;
}

function folderChildren(folder: LectureFolderNode): LectureFolderNode[] {
  return folder.children.filter((c) => c.type === "folder") as LectureFolderNode[];
}

function leafChildren(folder: LectureFolderNode): LectureLeafNode[] {
  return folder.children.filter((c) => c.type === "leaf") as LectureLeafNode[];
}

function flattenLeafRows(folder: LectureFolderNode, prefix = ""): LeafRow[] {
  const rows: LeafRow[] = [];
  for (const child of folder.children) {
    if (child.type === "leaf") {
      rows.push({ leaf: child as LectureLeafNode, pathLabel: prefix });
      continue;
    }
    const childFolder = child as LectureFolderNode;
    const nextPrefix = prefix ? `${prefix} / ${childFolder.title}` : childFolder.title;
    rows.push(...flattenLeafRows(childFolder, nextPrefix));
  }
  return rows;
}

function pickValidId(currentId: string | null, items: { id: string }[]): string | null {
  if (currentId && items.some((item) => item.id === currentId)) return currentId;
  return items[0]?.id ?? null;
}

function safeTrim(v: string | undefined): string {
  return (v ?? "").trim();
}

export default function LecturesPage() {
  const [tree, setTree] = useState<LectureTree | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editSnapshot, setEditSnapshot] = useState<LectureTree | null>(null);

  const [selectedGradeId, setSelectedGradeId] = useState<string | null>(null);
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [expandedSectionIds, setExpandedSectionIds] = useState<string[]>([]);

  const [selection, setSelection] = useState<Selection>(null);
  const [draft, setDraft] = useState<Draft>(null);

  const [newGradeTitle, setNewGradeTitle] = useState("");
  const [newCurriculumTitle, setNewCurriculumTitle] = useState("");
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newLectureTitle, setNewLectureTitle] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      const loaded = loadLectureTree();
      setTree(loaded);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  const gradeFolders = useMemo(() => {
    if (!tree) return [] as LectureFolderNode[];
    return folderChildren(tree.root);
  }, [tree]);

  const selectedGrade = useMemo(() => {
    const id = pickValidId(selectedGradeId, gradeFolders);
    if (!id) return null;
    return gradeFolders.find((g) => g.id === id) ?? null;
  }, [gradeFolders, selectedGradeId]);

  const curriculumFolders = useMemo(() => {
    if (!selectedGrade) return [] as LectureFolderNode[];
    return folderChildren(selectedGrade);
  }, [selectedGrade]);

  const selectedCurriculum = useMemo(() => {
    const id = pickValidId(selectedCurriculumId, curriculumFolders);
    if (!id) return null;
    return curriculumFolders.find((c) => c.id === id) ?? null;
  }, [curriculumFolders, selectedCurriculumId]);

  const sectionFolders = useMemo(() => {
    if (!selectedCurriculum) return [] as LectureFolderNode[];
    return folderChildren(selectedCurriculum);
  }, [selectedCurriculum]);

  const selectedSection = useMemo(() => {
    const id = pickValidId(selectedSectionId, sectionFolders);
    if (!id) return null;
    return sectionFolders.find((s) => s.id === id) ?? null;
  }, [sectionFolders, selectedSectionId]);

  const directLeafRows = useMemo(() => {
    if (!selectedCurriculum) return [] as LeafRow[];
    return leafChildren(selectedCurriculum).map((leaf) => ({ leaf, pathLabel: "" }));
  }, [selectedCurriculum]);

  const openedSectionIds = useMemo(() => {
    const kept = expandedSectionIds.filter((id) => sectionFolders.some((s) => s.id === id));
    if (kept.length > 0) return kept;
    if (sectionFolders.length === 0) return [] as string[];
    return [sectionFolders[0].id];
  }, [expandedSectionIds, sectionFolders]);

  const activeSelection = useMemo(() => {
    if (!tree || !selection) return null;
    const n = findNodeById(tree, selection.id);
    if (!n || n.type !== "leaf") return null;
    return selection;
  }, [tree, selection]);

  const activeDraft = activeSelection ? draft : null;

  function selectLeaf(leaf: LectureLeafNode) {
    const problem0 = safeTrim(leaf.problemUrls?.[0] ?? "");
    setSelection({
      id: leaf.id,
      title: leaf.title,
      lectureUrl: safeTrim(leaf.lectureUrl),
      problem0,
    });
    setDraft({
      title: leaf.title,
      lectureUrl: safeTrim(leaf.lectureUrl),
      problem0,
    });
  }

  function isDraftDirty() {
    if (!activeSelection || !activeDraft) return false;
    return (
      activeSelection.title !== activeDraft.title ||
      activeSelection.lectureUrl !== activeDraft.lectureUrl ||
      activeSelection.problem0 !== activeDraft.problem0
    );
  }

  function applyDraft(baseTree: LectureTree): { nextTree: LectureTree; nextSelection: Selection } {
    if (!activeSelection || !activeDraft || !isDraftDirty()) {
      return { nextTree: baseTree, nextSelection: activeSelection ?? null };
    }
    const nextTitle = updateNodeTitle(baseTree, activeSelection.id, activeDraft.title);
    const next = updateLeafLinks(nextTitle, activeSelection.id, {
      lectureUrl: activeDraft.lectureUrl,
      problemUrls: [activeDraft.problem0],
    });
    const nextSel: Selection = {
      ...activeSelection,
      title: activeDraft.title,
      lectureUrl: activeDraft.lectureUrl,
      problem0: activeDraft.problem0,
    };
    return { nextTree: next, nextSelection: nextSel };
  }

  function saveDraftLocal() {
    if (!tree) return false;
    const { nextTree, nextSelection } = applyDraft(tree);
    if (nextTree === tree) return true;
    setTree(nextTree);
    setSelection(nextSelection);
    if (nextSelection) {
      setDraft({
        title: nextSelection.title,
        lectureUrl: nextSelection.lectureUrl,
        problem0: nextSelection.problem0,
      });
    }
    return true;
  }

  function withDraftSaved(action: () => void) {
    if (editMode && isDraftDirty()) {
      const ok = window.confirm("현재 강의 편집 내용을 먼저 반영하고 이동할까요?");
      if (!ok) return;
      const saved = saveDraftLocal();
      if (!saved) return;
    }
    action();
  }

  function requireEditMode() {
    if (editMode) return true;
    window.alert("먼저 편집 버튼을 눌러주세요.");
    return false;
  }

  function startEdit() {
    if (!tree) return;
    setEditSnapshot(cloneTree(tree));
    setEditMode(true);
  }

  function cancelEdit() {
    if (!editSnapshot) {
      setEditMode(false);
      return;
    }
    setTree(cloneTree(editSnapshot));
    setEditSnapshot(null);
    setEditMode(false);
  }

  function saveEdit() {
    if (!tree) return;
    const applied = applyDraft(tree);
    const saved = saveLectureTreeWithReindex(applied.nextTree);
    setTree(saved);
    setSelection(applied.nextSelection);
    if (applied.nextSelection) {
      setDraft({
        title: applied.nextSelection.title,
        lectureUrl: applied.nextSelection.lectureUrl,
        problem0: applied.nextSelection.problem0,
      });
    }
    setEditSnapshot(null);
    setEditMode(false);
  }

  function onAddGrade() {
    if (!tree || !requireEditMode()) return;
    const title = newGradeTitle.trim();
    if (!title) {
      window.alert("학년 이름을 입력해주세요.");
      return;
    }
    const next = addFolder(tree, tree.root.id, title);
    const root = findFolderById(next, next.root.id);
    const created = root ? folderChildren(root).slice(-1)[0] : null;
    setTree(next);
    setNewGradeTitle("");
    if (created) setSelectedGradeId(created.id);
  }

  function onAddCurriculum() {
    if (!tree || !requireEditMode()) return;
    if (!selectedGrade) {
      window.alert("먼저 학년 탭을 선택해주세요.");
      return;
    }
    const title = newCurriculumTitle.trim();
    if (!title) {
      window.alert("과정 이름을 입력해주세요.");
      return;
    }
    const next = addFolder(tree, selectedGrade.id, title);
    const parent = findFolderById(next, selectedGrade.id);
    const created = parent ? folderChildren(parent).slice(-1)[0] : null;
    setTree(next);
    setNewCurriculumTitle("");
    if (created) setSelectedCurriculumId(created.id);
  }

  function onAddSection() {
    if (!tree || !requireEditMode()) return;
    if (!selectedCurriculum) {
      window.alert("먼저 과정을 선택해주세요.");
      return;
    }
    const title = newSectionTitle.trim();
    if (!title) {
      window.alert("단원(폴더) 이름을 입력해주세요.");
      return;
    }
    const next = addFolder(tree, selectedCurriculum.id, title);
    const parent = findFolderById(next, selectedCurriculum.id);
    const created = parent ? folderChildren(parent).slice(-1)[0] : null;
    setTree(next);
    setNewSectionTitle("");
    if (created) {
      setSelectedSectionId(created.id);
      setExpandedSectionIds((prev) => Array.from(new Set([...prev, created.id])));
    }
  }

  function onAddLecture() {
    if (!tree || !requireEditMode()) return;
    if (!selectedSection) {
      window.alert("먼저 단원을 선택해주세요.");
      return;
    }
    const title = newLectureTitle.trim();
    if (!title) {
      window.alert("강의 제목을 입력해주세요.");
      return;
    }
    const next = addLeaf(tree, selectedSection.id, { title, lectureUrl: "", problemUrls: [""] });
    const parent = findFolderById(next, selectedSection.id);
    const created = parent ? leafChildren(parent).slice(-1)[0] : null;
    setTree(next);
    setNewLectureTitle("");
    if (created) selectLeaf(created);
  }

  function onDeleteNode(nodeId: string, label: string) {
    if (!tree || !requireEditMode()) return;
    if (nodeId === tree.root.id) {
      window.alert("루트 폴더는 삭제할 수 없습니다.");
      return;
    }
    const ok = window.confirm(`${label}을(를) 삭제할까요? 하위 강의도 함께 삭제됩니다.`);
    if (!ok) return;
    const next = deleteNode(tree, nodeId);
    setTree(next);
    if (selection?.id === nodeId) {
      setSelection(null);
      setDraft(null);
    }
  }

  function toggleSection(sectionId: string) {
    setExpandedSectionIds((prev) => {
      if (prev.includes(sectionId)) return prev.filter((id) => id !== sectionId);
      return [...prev, sectionId];
    });
  }

  if (!tree) {
    return (
      <div className="p-6">
        <div className="text-sm text-neutral-600">강의 저장소를 불러오는 중...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">강의 저장소</h1>
          <p className="text-sm text-neutral-600">
            요청하신 스타일처럼 학년 탭과 과정 드롭다운으로 강의를 관리합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                저장
              </button>
            </>
          )}
        </div>
      </header>

      <div className="rounded-2xl border bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          {gradeFolders.length === 0 ? (
            <span className="text-sm text-neutral-500">학년 탭이 아직 없습니다. 편집 모드에서 추가해주세요.</span>
          ) : (
            gradeFolders.map((grade) => {
              const active = grade.id === selectedGrade?.id;
              return (
                <button
                  key={grade.id}
                  className={`px-4 py-2 rounded-md border text-sm ${
                    active ? "bg-sky-100 border-sky-300 text-sky-900" : "bg-white hover:bg-neutral-50"
                  }`}
                  onClick={() =>
                    withDraftSaved(() => {
                      setSelectedGradeId(grade.id);
                    })
                  }
                >
                  {grade.title}
                </button>
              );
            })
          )}

          <div className="mx-1 h-8 w-px bg-neutral-200" />

          <select
            className="min-w-[220px] rounded-md border px-3 py-2 text-sm bg-white"
            value={selectedCurriculum?.id ?? ""}
            onChange={(e) =>
              withDraftSaved(() => {
                setSelectedCurriculumId(e.target.value || null);
              })
            }
            disabled={!selectedGrade}
          >
            {!selectedGrade ? <option value="">먼저 학년을 선택하세요</option> : null}
            {curriculumFolders.map((curr) => (
              <option key={curr.id} value={curr.id}>
                {curr.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-2xl border bg-white overflow-hidden">
          <div className="px-4 py-3 border-b bg-neutral-50 text-sm font-semibold">
            {selectedCurriculum ? selectedCurriculum.title : "과정을 선택해주세요"}
          </div>

          <div className="max-h-[62vh] overflow-y-auto">
            {selectedCurriculum ? (
              <>
                {directLeafRows.length > 0 ? (
                  <div className="border-b">
                    <div className="px-4 py-2 text-sm font-semibold text-neutral-700 bg-neutral-50">기본 목록</div>
                    <div className="px-2 py-2 space-y-1">
                      {directLeafRows.map((row, index) => {
                        const selected = activeSelection?.id === row.leaf.id;
                        return (
                          <button
                            key={row.leaf.id}
                            className={`w-full flex items-center gap-2 rounded px-2 py-2 text-left ${
                              selected ? "bg-sky-100" : "hover:bg-neutral-50"
                            }`}
                            onClick={() =>
                              withDraftSaved(() => {
                                selectLeaf(row.leaf);
                              })
                            }
                          >
                            <span
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                                selected ? "bg-sky-500 text-white" : "bg-neutral-200 text-neutral-700"
                              }`}
                            >
                              ▶
                            </span>
                            <span className="text-sm">{`[${index + 1}강] ${row.leaf.title}`}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {sectionFolders.map((section) => {
                  const opened = openedSectionIds.includes(section.id);
                  const rows = flattenLeafRows(section);
                  const activeSection = section.id === selectedSection?.id;
                  return (
                    <div key={section.id} className="border-b">
                      <button
                        className={`w-full flex items-center justify-between px-4 py-2 text-left ${
                          activeSection ? "bg-neutral-100" : "bg-white hover:bg-neutral-50"
                        }`}
                        onClick={() =>
                          withDraftSaved(() => {
                            setSelectedSectionId(section.id);
                            toggleSection(section.id);
                          })
                        }
                      >
                        <span className="font-semibold text-sm">{section.title}</span>
                        <span className="text-xs text-neutral-500">{opened ? "▼" : "▶"}</span>
                      </button>
                      {opened ? (
                        <div className="px-2 py-2 space-y-1 bg-white">
                          {rows.length === 0 ? (
                            <div className="px-2 py-2 text-xs text-neutral-500">강의가 없습니다.</div>
                          ) : (
                            rows.map((row, index) => {
                              const selected = activeSelection?.id === row.leaf.id;
                              return (
                                <button
                                  key={row.leaf.id}
                                  className={`w-full flex items-center gap-2 rounded px-2 py-2 text-left ${
                                    selected ? "bg-sky-100" : "hover:bg-neutral-50"
                                  }`}
                                  onClick={() =>
                                    withDraftSaved(() => {
                                      selectLeaf(row.leaf);
                                    })
                                  }
                                >
                                  <span
                                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                                      selected ? "bg-sky-500 text-white" : "bg-neutral-200 text-neutral-700"
                                    }`}
                                  >
                                    ▶
                                  </span>
                                  <div className="min-w-0">
                                    <div className="truncate text-sm">{`[${index + 1}강] ${row.leaf.title}`}</div>
                                    {row.pathLabel ? (
                                      <div className="truncate text-[11px] text-neutral-500">{row.pathLabel}</div>
                                    ) : null}
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}

                {sectionFolders.length === 0 && directLeafRows.length === 0 ? (
                  <div className="p-4 text-sm text-neutral-500">이 과정에 단원/강의가 없습니다.</div>
                ) : null}
              </>
            ) : (
              <div className="p-4 text-sm text-neutral-500">과정을 선택하면 강의 목록이 표시됩니다.</div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4 space-y-4">
          <div className="text-sm font-semibold">강의 상세</div>

          {activeSelection && activeDraft ? (
            <div className="space-y-3">
              <div className="rounded-lg border bg-neutral-50 p-3 text-xs text-neutral-600">
                선택된 강의 ID: <span className="font-mono">{activeSelection.id}</span>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-neutral-600">제목</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={activeDraft.title}
                  onChange={(e) => setDraft({ ...activeDraft, title: e.target.value })}
                  disabled={!editMode}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-neutral-600">강의 URL</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={activeDraft.lectureUrl}
                  onChange={(e) => setDraft({ ...activeDraft, lectureUrl: e.target.value })}
                  placeholder="https://..."
                  disabled={!editMode}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-neutral-600">문제 URL (1)</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={activeDraft.problem0}
                  onChange={(e) => setDraft({ ...activeDraft, problem0: e.target.value })}
                  placeholder="https://..."
                  disabled={!editMode}
                />
              </div>

              {editMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50" onClick={saveDraftLocal}>
                    현재 반영
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50"
                    onClick={() =>
                      setDraft({
                        title: activeSelection.title,
                        lectureUrl: activeSelection.lectureUrl,
                        problem0: activeSelection.problem0,
                      })
                    }
                  >
                    현재값 되돌리기
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border text-sm text-red-600 hover:bg-red-50"
                    onClick={() => onDeleteNode(activeSelection.id, "강의")}
                  >
                    강의 삭제
                  </button>
                  {isDraftDirty() ? <span className="text-xs text-neutral-500">저장 전 변경 내용이 있습니다.</span> : null}
                </div>
              ) : (
                <div className="text-xs text-neutral-500">수정하려면 상단의 편집 버튼을 누르세요.</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-neutral-500">왼쪽 목록에서 강의를 선택해주세요.</div>
          )}

          {editMode ? (
            <div className="space-y-3 border-t pt-4">
              <div className="text-sm font-semibold">편집 도구</div>

              <div className="space-y-2">
                <div className="text-xs text-neutral-600">학년 탭 추가</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    value={newGradeTitle}
                    onChange={(e) => setNewGradeTitle(e.target.value)}
                    placeholder="예: 초 / 중 / 고"
                  />
                  <button className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50" onClick={onAddGrade}>
                    추가
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-neutral-600">과정 추가 (현재 학년)</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    value={newCurriculumTitle}
                    onChange={(e) => setNewCurriculumTitle(e.target.value)}
                    placeholder="예: 공통수학1(22개정)"
                  />
                  <button
                    className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50"
                    onClick={onAddCurriculum}
                    disabled={!selectedGrade}
                  >
                    추가
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-neutral-600">단원(폴더) 추가 (현재 과정)</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    value={newSectionTitle}
                    onChange={(e) => setNewSectionTitle(e.target.value)}
                    placeholder="예: 도형의 방정식"
                  />
                  <button
                    className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50"
                    onClick={onAddSection}
                    disabled={!selectedCurriculum}
                  >
                    추가
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-neutral-600">강의 추가 (현재 단원)</div>
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    value={newLectureTitle}
                    onChange={(e) => setNewLectureTitle(e.target.value)}
                    placeholder="예: 두 점 사이의 거리"
                  />
                  <button
                    className="px-3 py-2 rounded-lg border text-sm hover:bg-neutral-50"
                    onClick={onAddLecture}
                    disabled={!selectedSection}
                  >
                    추가
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  className="px-3 py-2 rounded-lg border text-sm text-red-600 hover:bg-red-50"
                  onClick={() => selectedSection && onDeleteNode(selectedSection.id, "단원")}
                  disabled={!selectedSection}
                >
                  현재 단원 삭제
                </button>
                <button
                  className="px-3 py-2 rounded-lg border text-sm text-red-600 hover:bg-red-50"
                  onClick={() => selectedCurriculum && onDeleteNode(selectedCurriculum.id, "과정")}
                  disabled={!selectedCurriculum}
                >
                  현재 과정 삭제
                </button>
                <button
                  className="px-3 py-2 rounded-lg border text-sm text-red-600 hover:bg-red-50"
                  onClick={() => selectedGrade && onDeleteNode(selectedGrade.id, "학년")}
                  disabled={!selectedGrade}
                >
                  현재 학년 삭제
                </button>
              </div>

              <div className="text-xs text-neutral-500">
                실제 저장은 상단 <b>저장</b> 버튼에서 한 번에 반영됩니다.
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <footer className="text-xs text-neutral-500">
        • 기존 folder/leaf 데이터 구조는 그대로 유지했습니다. • 저장 시 leaf orderKey가 재정렬됩니다.
      </footer>
    </div>
  );
}
