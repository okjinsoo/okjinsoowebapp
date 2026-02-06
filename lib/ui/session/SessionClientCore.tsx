// v1/lib/ui/session/SessionClientCore.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  LectureFolderNode,
  LectureLeafNode,
  LectureNode,
  LectureTree,
} from "@/lib/types/index";
import {
  loadLectureTree,
  findLeafById,
  getNextLeaf,
} from "@/lib/storage/lectures";

type Role = "s" | "t" | "a";

type Props = {
  token: string;
  sessionIndex: number; // 1-based
  role: Role;
  headerSlot?: React.ReactNode;
};

// ===== Final storage =====
type LeafProgress = {
  noteDone: boolean;
  solveDone: boolean;
  noteLink: string;
  solveLink: string;
  lectureClicks: number;
};
type ProgressByLeafId = Record<string, LeafProgress>;

function baseKey(token: string, sessionIndex: number) {
  return `mk3:${token}:session:${sessionIndex}`;
}
function keyLeafIds(token: string, sessionIndex: number) {
  return `${baseKey(token, sessionIndex)}:leafIds`;
}
function keyProgress(token: string, sessionIndex: number) {
  return `${baseKey(token, sessionIndex)}:progressByLeafId`;
}
function keyLastAdded(token: string, sessionIndex: number) {
  return `${baseKey(token, sessionIndex)}:lastAddedLeafId`;
}

function defaultProgress(): LeafProgress {
  return { noteDone: false, solveDone: false, noteLink: "", solveLink: "", lectureClicks: 0 };
}

function safeFolderTitle(tree: LectureTree, folderId: string): string {
  const stack: LectureNode[] = [tree.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "folder") {
      const f = n as LectureFolderNode;
      if (f.id === folderId) return f.title;
      for (let i = f.children.length - 1; i >= 0; i--) stack.push(f.children[i]);
    }
  }
  return "(폴더)";
}

function findFolder(tree: LectureTree, folderId: string): LectureFolderNode | null {
  const stack: LectureNode[] = [tree.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === "folder") {
      const f = n as LectureFolderNode;
      if (f.id === folderId) return f;
      for (let i = f.children.length - 1; i >= 0; i--) stack.push(f.children[i]);
    }
  }
  return null;
}

export default function SessionClientCore({ token, sessionIndex, role, headerSlot }: Props) {
  const canAssignLectures = role !== "s"; // ✅ t/a만 강의 배치(추가/삭제/추천저장) 가능
  const canEditProgress = true; // ✅ 학생도 체크/링크 입력은 가능

  const [mounted, setMounted] = useState(false);

  // ✅ final state
  const [lectureLeafIds, setLectureLeafIds] = useState<string[]>([]);
  const [progressByLeafId, setProgressByLeafId] = useState<ProgressByLeafId>({});
  const [lastAddedLeafId, setLastAddedLeafId] = useState<string>("");
  const [noteModal, setNoteModal] = useState<{ leafId: string; value: string } | null>(null);
  const [solveModal, setSolveModal] = useState<{ leafId: string; value: string } | null>(null);

  // tree
  const [tree, setTree] = useState<LectureTree>(() => loadLectureTree());

  // picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState<string[]>(() => [tree.root.id]);

  // recommend (not persisted)
  const [hideRecommend, setHideRecommend] = useState(false);

  // load (final only)
  useEffect(() => {
    const id = setTimeout(() => {
      setMounted(true);

      const t = loadLectureTree();
      setTree(t);
      setPickerPath([t.root.id]);

      const leafIdsRaw = localStorage.getItem(keyLeafIds(token, sessionIndex));
      const progRaw = localStorage.getItem(keyProgress(token, sessionIndex));
      const lastRaw = localStorage.getItem(keyLastAdded(token, sessionIndex));

      if (leafIdsRaw) {
        try {
          const ids = JSON.parse(leafIdsRaw) as string[];
          setLectureLeafIds(Array.isArray(ids) ? ids : []);
        } catch {
          setLectureLeafIds([]);
        }

        try {
          const prog = progRaw ? (JSON.parse(progRaw) as ProgressByLeafId) : {};
          setProgressByLeafId(prog && typeof prog === "object" ? prog : {});
        } catch {
          setProgressByLeafId({});
        }

        setLastAddedLeafId(lastRaw ?? "");
        return;
      }

      // final keys 없으면 비어있는 상태로 시작
      setLectureLeafIds([]);
      setProgressByLeafId({});
      setLastAddedLeafId("");
    }, 0);
    return () => clearTimeout(id);
  }, [token, sessionIndex]);

  // save (progress는 모두 저장 / 배치는 t/a만 저장)
  useEffect(() => {
    if (!mounted) return;
    if (!canAssignLectures) return;
    localStorage.setItem(keyLeafIds(token, sessionIndex), JSON.stringify(lectureLeafIds));
  }, [mounted, canAssignLectures, token, sessionIndex, lectureLeafIds]);

  useEffect(() => {
    if (!mounted) return;
    if (!canEditProgress) return;
    localStorage.setItem(keyProgress(token, sessionIndex), JSON.stringify(progressByLeafId));
  }, [mounted, canEditProgress, token, sessionIndex, progressByLeafId]);

  useEffect(() => {
    if (!mounted) return;
    if (!canAssignLectures) return;
    if (lastAddedLeafId) localStorage.setItem(keyLastAdded(token, sessionIndex), lastAddedLeafId);
    else localStorage.removeItem(keyLastAdded(token, sessionIndex));
  }, [mounted, canAssignLectures, token, sessionIndex, lastAddedLeafId]);

  const usedLeafIds = useMemo(() => new Set(lectureLeafIds), [lectureLeafIds]);

  function getLeaf(leafId: string) {
    return findLeafById(tree, leafId);
  }

  function updateProgress(leafId: string, patch: Partial<LeafProgress>) {
    if (!canEditProgress) return;
    setProgressByLeafId((prev) => {
      const cur = prev[leafId] ?? defaultProgress();
      return { ...prev, [leafId]: { ...cur, ...patch } };
    });
  }

  function resetSubmission(leafId: string) {
    if (!canAssignLectures) return;
    setProgressByLeafId((prev) => {
      const cur = prev[leafId] ?? defaultProgress();
      return {
        ...prev,
        [leafId]: {
          ...defaultProgress(),
          lectureClicks: cur.lectureClicks ?? 0,
        },
      };
    });
  }

  function removeLeaf(leafId: string) {
    if (!canAssignLectures) return; // ✅ 학생은 실행 자체 불가

    setLectureLeafIds((prev) => {
      const next = prev.filter((id) => id !== leafId);
      setLastAddedLeafId((prevLast) => {
        if (prevLast !== leafId) return prevLast;
        return next.length ? next[next.length - 1] : "";
      });
      return next;
    });

    setProgressByLeafId((prev) => {
      const next = { ...prev };
      delete next[leafId];
      return next;
    });
  }

  function addLectureLeaf(leaf: LectureLeafNode) {
    if (!canAssignLectures) return; // ✅ 학생은 실행 자체 불가
    if (usedLeafIds.has(leaf.leafId)) {
      window.alert("이미 이 회차에 배치된 강의입니다. (중복 불가)");
      return;
    }
    setLectureLeafIds((prev) => [...prev, leaf.leafId]);
    setProgressByLeafId((prev) => ({
      ...prev,
      [leaf.leafId]: prev[leaf.leafId] ?? defaultProgress(),
    }));
    setLastAddedLeafId(leaf.leafId);
    setHideRecommend(false);
  }

  // ✅ recommend 기준: lastAddedLeafId (없으면 마지막 줄 fallback)
  const recommended = useMemo(() => {
    if (!canAssignLectures) return null; // ✅ 학생은 추천 자체를 안 씀(저장 불가이므로)
    if (hideRecommend) return null;
    const base = lastAddedLeafId || lectureLeafIds[lectureLeafIds.length - 1];
    if (!base) return null;
    return getNextLeaf(tree, base, Array.from(usedLeafIds));
  }, [canAssignLectures, tree, lectureLeafIds, usedLeafIds, hideRecommend, lastAddedLeafId]);

  // picker
  const currentFolder = useMemo(() => {
    const curId = pickerPath[pickerPath.length - 1];
    return findFolder(tree, curId);
  }, [tree, pickerPath]);

  function openPicker() {
    if (!canAssignLectures) return;
    const t = loadLectureTree();
    setTree(t);
    setPickerOpen(true);
    setPickerPath([t.root.id]);
  }
  function closePicker() {
    setPickerOpen(false);
  }
  function enterFolder(folderId: string) {
    setPickerPath((prev) => [...prev, folderId]);
  }
  function goBack() {
    setPickerPath((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }
  function goToRoot() {
    setPickerPath([tree.root.id]);
  }

  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="card-title">오늘의 학습</div>
      </div>

      {headerSlot ? <div style={{ marginTop: 8 }}>{headerSlot}</div> : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
        <div />
        {canAssignLectures ? (
          <button onClick={openPicker} className="btn btn-black">
            + 강의 추가
          </button>
        ) : (
          <div style={{ fontWeight: 400, color: "#444" }}>
            ※ 필기 초기화는 담당 선생님께 부탁드리면 도와드릴게요!
          </div>
        )}
      </div>

      {recommended ? (
        <div
          style={{
            border: "1px dashed #bbb",
            borderRadius: 10,
            padding: 12,
            marginTop: 12,
            marginBottom: 12,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            추천 다음 강의 · {recommended.title}
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button
              onClick={() => addLectureLeaf(recommended)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #000",
                background: "#000",
                color: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              추가
            </button>
            <button
              onClick={() => setHideRecommend(true)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid #ddd",
                background: "#fff",
                cursor: "pointer",
                fontWeight: 500,
              }}
            >
              취소
            </button>
          </div>

        </div>
      ) : null}

      <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
        {lectureLeafIds.map((leafId, idx) => {
          const leaf = getLeaf(leafId);
          const p = progressByLeafId[leafId] ?? defaultProgress();
          const lectureUrl = leaf?.lectureUrl?.trim() ?? "";
          const problemUrl =
            leaf?.problemUrls?.map((u) => (u ?? "").trim()).find((u) => u) ?? "";
          const noteLocked = !!p.noteDone;
          const solveLocked = !!p.solveDone;
          const canOpenLecture = !!lectureUrl && !noteLocked;
          const canOpenProblem = !!problemUrl && noteLocked;
          const canSubmitNote = !noteLocked;
          const canSubmitSolve = noteLocked && !solveLocked;

          return (
            <div
              key={leafId}
              style={{
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 12,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {idx + 1}. {leaf?.title ?? "(삭제되었거나 찾을 수 없는 강의)"}{" "}
                    <span style={{ fontWeight: 600, opacity: 0.75 }}>
                      [ 학습 횟수 : {p.lectureClicks ?? 0}회 ]
                    </span>
                  </div>
                  <div style={{ opacity: 0.7, marginTop: 4 }}>
                    leafId: {leafId} {leaf?.orderKey ? `· orderKey: ${leaf.orderKey}` : ""}
                  </div>
                </div>

                {canAssignLectures ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button
                      onClick={() => {
                        const ok = window.confirm("제출 정보를 초기화할까요? (필기/풀이 링크와 상태가 초기화됩니다)");
                        if (!ok) return;
                        resetSubmission(leafId);
                      }}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                        height: 32,
                        fontWeight: 500,
                      }}
                    >
                      제출 초기화
                    </button>
                    <button
                      onClick={() => removeLeaf(leafId)}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid #ddd",
                        background: "#fff",
                        cursor: "pointer",
                        height: 32,
                        fontWeight: 500,
                      }}
                    >
                      삭제
                    </button>
                  </div>
                ) : null}
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {(() => {
                  const primaryBorder = noteLocked ? "#cfd4dc" : "#a9c9ff";
                  const primaryBg = noteLocked ? "#f0f1f3" : "#e8f1ff";
                  const secondaryBorder = noteLocked ? "#a9c9ff" : "#cfd4dc";
                  const secondaryBg = noteLocked ? "#e8f1ff" : "#f0f1f3";

                  const lectureStyle = {
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${primaryBorder}`,
                    background: primaryBg,
                    cursor: canOpenLecture ? "pointer" : "not-allowed",
                  } as const;

                  const noteStyle = {
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${primaryBorder}`,
                    background: primaryBg,
                    cursor: canSubmitNote ? "pointer" : "not-allowed",
                  } as const;

                  const problemStyle = {
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${secondaryBorder}`,
                    background: secondaryBg,
                    cursor: canOpenProblem ? "pointer" : "not-allowed",
                  } as const;

                  const solveStyle = {
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: `1px solid ${secondaryBorder}`,
                    background: secondaryBg,
                    cursor: canSubmitSolve ? "pointer" : "not-allowed",
                  } as const;

                  return (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(90px, 1fr))", gap: 8 , alignItems: "center"}}>
                  <button
                    onClick={() => {
                      if (!lectureUrl) return;
                      if (noteLocked) return;
                      updateProgress(leafId, { lectureClicks: (p.lectureClicks ?? 0) + 1 });
                      window.open(lectureUrl, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!canOpenLecture}
                    style={lectureStyle}
                  >
                    강의
                  </button>

                  <button
                    onClick={() => {
                      if (!canSubmitNote) return;
                      setNoteModal({ leafId, value: (p.noteLink ?? "").trim() });
                    }}
                    disabled={!canSubmitNote}
                    style={noteStyle}
                  >
                    필기 제출
                  </button>

                  <button
                    onClick={() => {
                      if (!problemUrl) return;
                      if (!noteLocked) return;
                      window.open(problemUrl, "_blank", "noopener,noreferrer");
                    }}
                    disabled={!canOpenProblem}
                    style={problemStyle}
                  >
                    문제
                  </button>

                  <button
                    onClick={() => {
                      if (!canSubmitSolve) return;
                      setSolveModal({ leafId, value: (p.solveLink ?? "").trim() });
                    }}
                    disabled={!canSubmitSolve}
                    style={solveStyle}
                  >
                    풀이 제출
                  </button>
                </div>
                  );
                })()}

                <div style={{ color: "#666" }}>
                  필기 URL:{" "}
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {p.noteLink ? p.noteLink : "-"}
                  </span>
                </div>

                <div style={{ color: "#666" }}>
                  풀이 URL:{" "}
                  <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                    {p.solveLink ? p.solveLink : "-"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {lectureLeafIds.length === 0 ? (
          <div style={{ padding: 12, border: "1px dashed #ccc", borderRadius: 12, opacity: 0.75 }}>
            아직 이 회차에 배치된 강의가 없습니다.
          </div>
        ) : null}
      </div>

      {noteModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 1000,
          }}
          onClick={() => setNoteModal(null)}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              border: "1px solid #eee",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>필기 제출</div>
            <div style={{ color: "#666", marginBottom: 8 }}>
              필기 제출 파일 URL을 입력하세요.
            </div>
            <input
              value={noteModal.value}
              onChange={(e) => setNoteModal({ ...noteModal, value: e.target.value })}
              placeholder="https://..."
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => {
                  const link = noteModal.value.trim();
                  if (!link) {
                    window.alert("필기 제출 파일 URL을 입력해주세요.");
                    return;
                  }
                  const ok = window.confirm(
                    "제출 후 강의와 필기 파일을 수정할 수 없습니다. 문제풀 준비가 되었나요?"
                  );
                  if (!ok) return;
                  updateProgress(noteModal.leafId, { noteDone: true, noteLink: link });
                  setNoteModal(null);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #a9c9ff",
                  background: "#e8f1ff",
                }}
              >
                제출
              </button>
              <button
                onClick={() => setNoteModal(null)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {solveModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 1000,
          }}
          onClick={() => setSolveModal(null)}
        >
          <div
            style={{
              width: "min(520px, 100%)",
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              border: "1px solid #eee",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>풀이 제출</div>
            <div style={{ color: "#666", marginBottom: 8 }}>
              풀이 제출 파일 URL을 입력하세요.
            </div>
            <input
              value={solveModal.value}
              onChange={(e) => setSolveModal({ ...solveModal, value: e.target.value })}
              placeholder="https://..."
              style={{
                width: "100%",
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ddd",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button
                onClick={() => {
                  const link = solveModal.value.trim();
                  if (!link) {
                    window.alert("풀이 제출 파일 URL을 입력해주세요.");
                    return;
                  }
                  updateProgress(solveModal.leafId, { solveDone: true, solveLink: link });
                  setSolveModal(null);
                }}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #9bd7a0",
                  background: "#e9f7eb",
                }}
              >
                제출
              </button>
              <button
                onClick={() => setSolveModal(null)}
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid #ddd",
                  background: "#fff",
                }}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ===== picker modal (t/a only) ===== */}
      {canAssignLectures && pickerOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
            zIndex: 1000,
          }}
          onClick={closePicker}
        >
          <div
            style={{
              width: "min(720px, 100%)",
              maxHeight: "80vh",
              overflow: "auto",
              background: "#fff",
              borderRadius: 14,
              padding: 14,
              border: "1px solid #eee",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div className="card-title">강의 선택</div>
              <button
                onClick={closePicker}
                style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 10, padding: "6px 10px" }}
              >
                닫기
              </button>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={goToRoot}
                style={{ padding: "6px 10px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}
              >
                루트로
              </button>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={{ alignSelf: "center", opacity: 0.6 }}>경로:</span>
                <span style={{ alignSelf: "center", fontWeight: 700 }}>
                  {safeFolderTitle(tree, pickerPath[pickerPath.length - 1])}
                </span>
                {pickerPath.length > 1 ? (
                  <button
                    onClick={goBack}
                    style={{
                      marginLeft: 8,
                      padding: "4px 8px",
                      borderRadius: 10,
                      border: "1px solid #ddd",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    ← 뒤로
                  </button>
                ) : (
                  <span style={{ alignSelf: "center", opacity: 0.6 }}> (루트)</span>
                )}
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              {!currentFolder ? (
                <div style={{ opacity: 0.7 }}>폴더를 찾을 수 없습니다.</div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {currentFolder.children
                    .filter((c) => c.type === "folder")
                    .map((c) => {
                      const f = c as LectureFolderNode;
                      return (
                        <div
                          key={f.id}
                          style={{
                            border: "1px solid #eee",
                            borderRadius: 12,
                            padding: 10,
                            background: "#fff",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700 }}>{f.title}</div>
                            <div style={{ opacity: 0.7 }}>(folder)</div>
                          </div>
                          <button
                            onClick={() => enterFolder(f.id)}
                            style={{
                              padding: "6px 10px",
                              borderRadius: 10,
                              border: "1px solid #ddd",
                              background: "#fff",
                              cursor: "pointer",
                            }}
                          >
                            열기 →
                          </button>
                        </div>
                      );
                    })}

                  {currentFolder.children
                    .filter((c) => c.type === "leaf")
                    .map((c) => {
                      const leaf = c as LectureLeafNode;
                      const disabled = usedLeafIds.has(leaf.leafId);
                      return (
                        <button
                          key={leaf.id}
                          onClick={() => {
                            if (disabled) return;
                            addLectureLeaf(leaf);
                            closePicker();
                          }}
                          disabled={disabled}
                          style={{
                            textAlign: "left",
                            border: "1px solid #eee",
                            borderRadius: 12,
                            padding: 10,
                            background: disabled ? "#f3f3f3" : "#fff",
                            cursor: disabled ? "not-allowed" : "pointer",
                            opacity: disabled ? 0.6 : 1,
                          }}
                          title={disabled ? "이미 회차에 포함된 강의입니다(중복 불가)" : "선택하면 회차에 즉시 추가됩니다"}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {leaf.title} <span style={{ opacity: 0.7 }}>(leaf)</span>
                          </div>
                          <div style={{ opacity: 0.7, marginTop: 4 }}>
                            leafId: {leaf.leafId} · orderKey: {leaf.orderKey}
                          </div>
                        </button>
                      );
                    })}

                  {currentFolder.children.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>비어 있습니다.</div>
                  ) : null}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, opacity: 0.7 }}>
              • 중복된 강의(이미 회차에 포함)는 선택할 수 없습니다. • 선택 즉시 저장됩니다.
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
