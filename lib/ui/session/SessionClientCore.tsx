// v1/lib/ui/session/SessionClientCore.tsx
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import {
  pushSharedSnapshot,
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";
import {
  buildSessionStorageBaseKey,
  sessionLeafIdsKey,
  sessionProgressByLeafIdKey,
  SHARED_LECTURE_TREE_KEY,
} from "@/lib/storage/sharedStateKeys";
import {
  canAssignSessionLectures,
  canSeeSessionInternalFields,
  type SessionRole,
} from "@/lib/policies/sessionRolePolicy";

import { useEffect, useMemo, useState } from "react";
import type {
  LectureLeafNode,
  LectureTree,
} from "@/lib/types/index";
import {
  loadLectureTree,
  findLeafById,
  flattenLeaves,
  parseLectureTreeRaw,
} from "@/lib/storage/lectures";

type Props = {
  token: string;
  sessionIndex: number; // 1-based
  role: SessionRole;
  headerSlot?: React.ReactNode;
};

// ===== Final storage =====
type LeafProgress = {
  noteDone: boolean;
  solveDone: boolean;
  noteLink: string;
  solveLink: string;
  lectureClicks: number;
  // --- 임의 문제(Ad-hoc) 전용 정보 ---
  customTitle?: string;
  customProblemUrl?: string;
  // --- 공지(Notice) 전용 정보 ---
  noticeContent?: string;
};
type ProgressByLeafId = Record<string, LeafProgress>;
function keyLeafIds(token: string, sessionIndex: number) {
  return sessionLeafIdsKey(token, sessionIndex);
}
function keyProgress(token: string, sessionIndex: number) {
  return sessionProgressByLeafIdKey(token, sessionIndex);
}
function keyLastAdded(token: string, sessionIndex: number) {
  return `${buildSessionStorageBaseKey(token, sessionIndex)}:lastAddedLeafId`;
}

function defaultProgress(): LeafProgress {
  return { noteDone: false, solveDone: false, noteLink: "", solveLink: "", lectureClicks: 0 };
}

function updatedAtMs(tree: LectureTree): number | null {
  const ms = Date.parse(tree.updatedAt ?? "");
  return Number.isFinite(ms) ? ms : null;
}

function leafCount(tree: LectureTree): number {
  return flattenLeaves(tree, { sortByOrderKey: false }).length;
}

function pickLectureTree(localTree: LectureTree, remoteTree: LectureTree | null): {
  pickedTree: LectureTree;
  shouldBackfillRemote: boolean;
} {
  const localCount = leafCount(localTree);
  if (!remoteTree) {
    return {
      pickedTree: localTree,
      shouldBackfillRemote: localCount > 0,
    };
  }

  const remoteCount = leafCount(remoteTree);
  if (localCount > 0 && remoteCount === 0) {
    return {
      pickedTree: localTree,
      shouldBackfillRemote: true,
    };
  }
  if (localCount === 0 && remoteCount > 0) {
    return {
      pickedTree: remoteTree,
      shouldBackfillRemote: false,
    };
  }

  const localMs = updatedAtMs(localTree);
  const remoteMs = updatedAtMs(remoteTree);
  if (remoteMs !== null && (localMs === null || remoteMs >= localMs)) {
    return {
      pickedTree: remoteTree,
      shouldBackfillRemote: false,
    };
  }

  return {
    pickedTree: localTree,
    shouldBackfillRemote: localCount > 0,
  };
}

export default function SessionClientCore({ token, sessionIndex, role, headerSlot }: Props) {
  const canAssignLectures = canAssignSessionLectures(role); // ✅ t/a만 강의 배치(추가/삭제/추천저장) 가능
  const canEditProgress = true; // ✅ 학생도 체크/링크 입력은 가능
  const canSeeInternalFields = canSeeSessionInternalFields(role); // ✅ 학생에게는 내부 식별값/제출 URL 숨김

  const [mounted, setMounted] = useState(false);

  // ✅ final state
  const [lectureLeafIds, setLectureLeafIds] = useState<string[]>([]);
  const [progressByLeafId, setProgressByLeafId] = useState<ProgressByLeafId>({});
  const [lastAddedLeafId, setLastAddedLeafId] = useState<string>("");
  const [noteModal, setNoteModal] = useState<{ leafId: string; value: string } | null>(null);
  const [solveModal, setSolveModal] = useState<{ leafId: string; value: string } | null>(null);

  // 신규 모달 상태
  const [customModal, setCustomModal] = useState<{ title: string; url: string } | null>(null);
  const [noticeModal, setNoticeModal] = useState<{ content: string } | null>(null);

  // 순서 변경 모드
  const [isReordering, setIsReordering] = useState(false);

  // tree
  const [tree, setTree] = useState<LectureTree>(() => loadLectureTree());

  // picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSyncing, setPickerSyncing] = useState(false);

  // load (final only)
  useEffect(() => {
    const id = setTimeout(() => {
      setMounted(true);

      const t = loadLectureTree();
      setTree(t);

      const leafIdsRaw = browserStorage.getItem(keyLeafIds(token, sessionIndex));
      const progRaw = browserStorage.getItem(keyProgress(token, sessionIndex));
      const lastRaw = browserStorage.getItem(keyLastAdded(token, sessionIndex));

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

  useEffect(() => {
    if (!mounted) return;
    const onLectureTreeUpdated = () => {
      setTree(loadLectureTree());
    };
    window.addEventListener("tutorweb:lectureTreeUpdated", onLectureTreeUpdated);
    return () => {
      window.removeEventListener("tutorweb:lectureTreeUpdated", onLectureTreeUpdated);
    };
  }, [mounted]);

  // save (progress는 모두 저장 / 배치는 t/a만 저장)
  useEffect(() => {
    if (!mounted) return;
    if (!canAssignLectures) return;
    browserStorage.setItem(keyLeafIds(token, sessionIndex), JSON.stringify(lectureLeafIds));
  }, [mounted, canAssignLectures, token, sessionIndex, lectureLeafIds]);

  useEffect(() => {
    if (!mounted) return;
    if (!canEditProgress) return;
    browserStorage.setItem(keyProgress(token, sessionIndex), JSON.stringify(progressByLeafId));
  }, [mounted, canEditProgress, token, sessionIndex, progressByLeafId]);

  useEffect(() => {
    if (!mounted) return;
    if (!canAssignLectures) return;
    if (lastAddedLeafId) browserStorage.setItem(keyLastAdded(token, sessionIndex), lastAddedLeafId);
    else browserStorage.removeItem(keyLastAdded(token, sessionIndex));
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

  function moveLeaf(idx: number, direction: "up" | "down") {
    if (!canAssignLectures) return;
    setLectureLeafIds((prev) => {
      const next = [...prev];
      if (direction === "up" && idx > 0) {
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      } else if (direction === "down" && idx < next.length - 1) {
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      }
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
  }

  async function openPicker() {
    if (!canAssignLectures) return;
    setPickerSyncing(true);
    const localTree = loadLectureTree();
    let remoteTree: LectureTree | null = null;
    try {
      const remoteLectureTree = await readRemoteSharedStateKvValue(SHARED_LECTURE_TREE_KEY);
      if (typeof remoteLectureTree === "string" && remoteLectureTree.trim()) {
        remoteTree = parseLectureTreeRaw(remoteLectureTree);
      }
    } catch (err) {
      console.error("강의 목록 원격 동기화 실패:", err);
    }
    try {
      const picked = pickLectureTree(localTree, remoteTree);
      setTree(picked.pickedTree);
      setPickerOpen(true);
      setPickerQuery("");
      if (picked.shouldBackfillRemote) {
        const rawTree = JSON.stringify(picked.pickedTree);
        void pushSharedSnapshot({
          stateKv: {
            [SHARED_LECTURE_TREE_KEY]: rawTree,
          },
        }).catch((err) => {
          console.error("강의 트리 자동 복구 업로드 실패:", err);
        });
      }
    } finally {
      setPickerSyncing(false);
    }
  }
  function closePicker() {
    setPickerOpen(false);
  }

  const pickerLeafOptions = useMemo(() => {
    const leavesSorted = flattenLeaves(tree, { sortByOrderKey: true });
    return leavesSorted.map((leaf) => ({ leaf }));
  }, [tree]);

  const filteredPickerLeafOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerLeafOptions;
    return pickerLeafOptions.filter((item) => {
      const title = item.leaf.title.toLowerCase();
      return title.includes(q);
    });
  }, [pickerLeafOptions, pickerQuery]);

  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="card-title">오늘의 학습</div>
      </div>

      {headerSlot ? <div style={{ marginTop: 8 }}>{headerSlot}</div> : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
        <div />
        {canAssignLectures ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setIsReordering((r) => !r)}
              className="btn btn-black"
              style={{
                padding: "6px 12px",
                background: isReordering ? "var(--action-primary-bg)" : "var(--color-bg)",
                border: `1px solid ${isReordering ? "var(--action-primary-border)" : "var(--control-border)"}`,
                color: isReordering ? "var(--action-contrast-text)" : "var(--text-main)",
                fontWeight: isReordering ? 700 : 400,
              }}
            >
              {isReordering ? "순서 완료" : "순서 변경"}
            </button>
            <button
              onClick={() => setNoticeModal({ content: "" })}
              className="btn btn-black"
              style={{ padding: "6px 12px", background: "var(--color-bg)", border: "1px solid var(--control-border)", color: "var(--text-main)" }}
            >
              + 공지
            </button>
            <button
              onClick={() => setCustomModal({ title: "", url: "" })}
              className="btn btn-black"
              style={{ padding: "6px 12px", background: "var(--color-bg)", border: "1px solid var(--control-border)", color: "var(--text-main)" }}
            >
              + 문제 추가
            </button>
            <button onClick={() => void openPicker()} className="btn btn-black" disabled={pickerSyncing}>
              {pickerSyncing ? "강의 동기화 중..." : "+ 강의 추가"}
            </button>
          </div>
        ) : (
          <div style={{ fontWeight: 400, color: "var(--text-muted)" }}>
            ※ 필기 초기화는 담당 선생님께 부탁드리면 도와드릴게요!
          </div>
        )}
      </div>

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
                display: "flex",
                alignItems: "stretch",
                gap: 12,
              }}
            >
              {/* 순서 변경 모드 진입 시 표시되는 좌측 컨트롤 패널 */}
              {isReordering && canAssignLectures && (
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
                  <button
                    onClick={() => moveLeaf(idx, "up")}
                    disabled={idx === 0}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      border: "1px solid var(--surface-border)",
                      background: idx === 0 ? "var(--surface-hover)" : "var(--surface-bg)",
                      opacity: idx === 0 ? 0.4 : 1,
                      cursor: idx === 0 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => moveLeaf(idx, "down")}
                    disabled={idx === lectureLeafIds.length - 1}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      border: "1px solid var(--surface-border)",
                      background: idx === lectureLeafIds.length - 1 ? "var(--surface-hover)" : "var(--surface-bg)",
                      opacity: idx === lectureLeafIds.length - 1 ? 0.4 : 1,
                      cursor: idx === lectureLeafIds.length - 1 ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 14,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              )}

              {/* 기존 카드 본체 */}
              <div
                style={{
                  border: isReordering ? "2px dashed var(--action-primary-border)" : "1px solid var(--surface-border)",
                  borderRadius: 12,
                  padding: 12,
                  background: "var(--surface-bg)",
                  flex: 1,
                  transition: "all 0.2s ease-in-out",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {leafId.startsWith("notice_") ? (
                        `[공지] ${p.noticeContent || "내용 없음"}`
                      ) : leafId.startsWith("custom_") ? (
                        `${idx + 1}. ${p.customTitle || "제목 없는 문제"}`
                      ) : (
                        `${idx + 1}. ${leaf?.title ?? "(삭제되었거나 찾을 수 없는 강의)"}`
                      )}

                      {!leafId.startsWith("notice_") && (
                        <span style={{ fontWeight: 600, opacity: 0.75, marginLeft: 8 }}>
                          [ 학습 횟수 : {p.lectureClicks ?? 0}회 ]
                        </span>
                      )}
                    </div>
                    {canSeeInternalFields ? (
                      <div style={{ opacity: 0.7, marginTop: 4 }}>
                        leafId: {leafId} {leaf?.orderKey ? `· orderKey: ${leaf.orderKey}` : ""}
                      </div>
                    ) : null}
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
                          border: "1px solid var(--control-border)",
                          background: "var(--surface-bg)",
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
                          border: "1px solid var(--control-border)",
                          background: "var(--surface-bg)",
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

                {!leafId.startsWith("notice_") && (
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    {(() => {
                      const primaryBorder = noteLocked ? "var(--action-secondary-border)" : "var(--action-primary-border)";
                      const primaryBg = noteLocked ? "var(--action-secondary-bg)" : "var(--action-primary-bg)";
                      const secondaryBorder = noteLocked ? "var(--action-primary-border)" : "var(--action-secondary-border)";
                      const secondaryBg = noteLocked ? "var(--action-primary-bg)" : "var(--action-secondary-bg)";

                      const isCustom = leafId.startsWith("custom_");
                      // 임의 문제인 경우 문제 URL은 customProblemUrl 사용
                      const targetProblemUrl = isCustom ? (p.customProblemUrl || "") : problemUrl;

                      const lectureStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${primaryBorder}`,
                        background: primaryBg,
                        color: "var(--action-contrast-text)",
                        cursor: canOpenLecture ? "pointer" : "not-allowed",
                      } as const;

                      const noteStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${primaryBorder}`,
                        background: primaryBg,
                        color: "var(--action-contrast-text)",
                        cursor: canSubmitNote ? "pointer" : "not-allowed",
                      } as const;

                      const problemStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        // 임의 문제일 땐 필기 제출(잠금) 단계가 없으므로 primary 색상으로 표시
                        border: `1px solid ${isCustom ? "var(--action-primary-border)" : secondaryBorder}`,
                        background: isCustom ? "var(--action-primary-bg)" : secondaryBg,
                        color: "var(--action-contrast-text)",
                        cursor: isCustom ? (targetProblemUrl ? "pointer" : "not-allowed") : (canOpenProblem ? "pointer" : "not-allowed"),
                      } as const;

                      const solveStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${isCustom ? "var(--action-primary-border)" : secondaryBorder}`,
                        background: isCustom ? "var(--action-primary-bg)" : secondaryBg,
                        color: "var(--action-contrast-text)",
                        // 임의 문제 풀이 제출 상태도 별도로 따짐 (noteLocked 의존 제거)
                        cursor: isCustom ? (!solveLocked ? "pointer" : "not-allowed") : (canSubmitSolve ? "pointer" : "not-allowed"),
                      } as const;

                      return (
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "grid", gridTemplateColumns: isCustom ? "repeat(2, minmax(90px, 1fr))" : "repeat(4, minmax(90px, 1fr))", gap: 8, alignItems: "center" }}>
                            {!isCustom && (
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
                            )}

                            {!isCustom && (
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
                            )}

                            <button
                              onClick={() => {
                                if (!targetProblemUrl) return;
                                if (!isCustom && !noteLocked) return;
                                updateProgress(leafId, { lectureClicks: (p.lectureClicks ?? 0) + 1 }); // 문제 클릭 시에도 횟수 가산
                                window.open(targetProblemUrl, "_blank", "noopener,noreferrer");
                              }}
                              disabled={isCustom ? !targetProblemUrl : !canOpenProblem}
                              style={problemStyle}
                            >
                              문제
                            </button>

                            <button
                              onClick={() => {
                                if (!isCustom && !canSubmitSolve) return;
                                if (isCustom && solveLocked) return;
                                setSolveModal({ leafId, value: (p.solveLink ?? "").trim() });
                              }}
                              disabled={isCustom ? solveLocked : !canSubmitSolve}
                              style={solveStyle}
                            >
                              풀이 제출
                            </button>
                          </div>

                          <div style={{ display: "flex", gap: 16, alignItems: "center", color: "var(--text-muted)", fontSize: 13 }}>
                            {!isCustom && (
                              <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                                <input type="checkbox" checked={Boolean(p.noteDone)} readOnly />
                                필기 제출
                              </label>
                            )}
                            <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <input type="checkbox" checked={Boolean(p.solveDone)} readOnly />
                              풀이 제출
                            </label>
                          </div>
                        </div>
                      );
                    })()}

                    {canSeeInternalFields && !leafId.startsWith("custom_") && (
                      <div style={{ color: "var(--text-muted)" }}>
                        필기 URL:{" "}
                        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                          {p.noteLink ? p.noteLink : "-"}
                        </span>
                      </div>
                    )}

                    {canSeeInternalFields ? (
                      <div style={{ color: "var(--text-muted)" }}>
                        풀이 URL:{" "}
                        <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                          {p.solveLink ? p.solveLink : "-"}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {
          lectureLeafIds.length === 0 ? (
            <div style={{ padding: 12, border: "1px dashed var(--control-border)", borderRadius: 12, opacity: 0.75 }}>
              아직 이 회차에 배치된 강의가 없습니다.
            </div>
          ) : null
        }
      </div >

      {
        noteModal ? (
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
                background: "var(--surface-bg)",
                borderRadius: 14,
                padding: 16,
                border: "1px solid var(--surface-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>필기 제출</div>
              <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
                필기 제출 파일 URL을 입력하세요.
              </div>
              <input
                value={noteModal?.value || ''}
                onChange={(e) => setNoteModal((prev) => prev ? { ...prev, value: e.target.value } : null)}
                placeholder="https://..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--control-border)",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => {
                    const link = noteModal?.value || ''.trim();
                    if (!link) {
                      window.alert("필기 제출 파일 URL을 입력해주세요.");
                      return;
                    }
                    const ok = window.confirm(
                      "제출 후 강의와 필기 파일을 수정할 수 없습니다. 문제풀 준비가 되었나요?"
                    );
                    if (!ok) return;
                    updateProgress(noteModal!.leafId, { noteDone: true, noteLink: link });
                    setNoteModal(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--action-primary-border)",
                    background: "var(--action-primary-bg)",
                    color: "var(--action-contrast-text)",
                  }}
                >
                  제출
                </button>
                <button
                  onClick={() => setNoteModal(null)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--control-border)",
                    background: "var(--surface-bg)",
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          </div >
        ) : null
      }

      {
        solveModal ? (
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
                background: "var(--surface-bg)",
                borderRadius: 14,
                padding: 16,
                border: "1px solid var(--surface-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>풀이 제출</div>
              <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>
                풀이 제출 파일 URL을 입력하세요.
              </div>
              <input
                value={solveModal?.value || ''}
                onChange={(e) => setSolveModal((prev) => prev ? { ...prev, value: e.target.value } : null)}
                placeholder="https://..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid var(--control-border)",
                }}
              />
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => {
                    const link = solveModal?.value || ''.trim();
                    if (!link) {
                      window.alert("풀이 제출 파일 URL을 입력해주세요.");
                      return;
                    }
                    updateProgress(solveModal!.leafId, { solveDone: true, solveLink: link });
                    setSolveModal(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--action-success-border)",
                    background: "var(--action-success-bg)",
                    color: "var(--action-contrast-text)",
                  }}
                >
                  제출
                </button>
                <button
                  onClick={() => setSolveModal(null)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--control-border)",
                    background: "var(--surface-bg)",
                  }}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        ) : null
      }

      {/* 임의 문제 추가 모달 */}
      {
        customModal && canAssignLectures ? (
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
            onClick={() => setCustomModal(null)}
          >
            <div
              style={{
                width: "min(520px, 100%)",
                background: "var(--surface-bg)",
                borderRadius: 14,
                padding: 16,
                border: "1px solid var(--surface-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>+ 문제 추가</div>
              <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
                회차에 일회성 문제(쪽지시험, 숙제 등)를 추가합니다.
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>문제 제목</label>
                  <input
                    value={customModal?.title || ''}
                    onChange={(e) => setCustomModal((prev) => prev ? { ...prev, title: e.target.value } : null)}
                    placeholder="예: 3월 1주차 모의평가"
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid var(--control-border)" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 4 }}>문제 URL (클릭 시 열릴 링크)</label>
                  <input
                    value={customModal?.url || ''}
                    onChange={(e) => setCustomModal((prev) => prev ? { ...prev, url: e.target.value } : null)}
                    placeholder="https://..."
                    style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid var(--control-border)" }}
                  />
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => {
                    const titleStr = customModal?.title || ''.trim() || "제목 없는 문제";
                    const urlStr = customModal?.url || ''.trim();

                    // custom_ 로 시작하는 고유 ID 발급
                    const randId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
                    const leafId = `custom_${randId}`;

                    // 배열 제일 끝에 삽입하고, progress에 메타데이터 저장
                    setLectureLeafIds((prev) => [...prev, leafId]);
                    setProgressByLeafId((prev) => ({
                      ...prev,
                      [leafId]: { ...defaultProgress(), customTitle: titleStr, customProblemUrl: urlStr },
                    }));
                    setLastAddedLeafId(leafId);

                    setCustomModal(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--action-primary-border)",
                    background: "var(--action-primary-bg)",
                    color: "var(--action-contrast-text)",
                    fontWeight: 600,
                  }}
                >
                  문제 추가
                </button>
                <button
                  onClick={() => setCustomModal(null)}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--control-border)", background: "var(--surface-bg)" }}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        ) : null
      }

      {/* 공지 추가 모달 */}
      {
        noticeModal && canAssignLectures ? (
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
            onClick={() => setNoticeModal(null)}
          >
            <div
              style={{
                width: "min(520px, 100%)",
                background: "var(--surface-bg)",
                borderRadius: 14,
                padding: 16,
                border: "1px solid var(--surface-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ fontWeight: 800, marginBottom: 8 }}>+ 공지사항 등록</div>
              <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
                진도율에 포함되지 않는 텍스트 알림을 회차에 추가합니다.
              </div>

              <textarea
                value={noticeModal?.content || ''}
                onChange={(e) => setNoticeModal((prev) => prev ? { content: e.target.value } : null)}
                placeholder="전달할 내용을 입력하세요."
                rows={4}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1px solid var(--control-border)", resize: "vertical" }}
              />

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => {
                    const contentStr = noticeModal?.content || ''.trim();
                    if (!contentStr) {
                      window.alert("내용을 입력해주세요.");
                      return;
                    }

                    const randId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
                    const leafId = `notice_${randId}`;

                    setLectureLeafIds((prev) => [...prev, leafId]);
                    setProgressByLeafId((prev) => ({
                      ...prev,
                      [leafId]: { ...defaultProgress(), noticeContent: contentStr },
                    }));
                    setLastAddedLeafId(leafId);

                    setNoticeModal(null);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--action-primary-border)",
                    background: "var(--action-primary-bg)",
                    color: "var(--action-contrast-text)",
                    fontWeight: 600,
                  }}
                >
                  공지 등록
                </button>
                <button
                  onClick={() => setNoticeModal(null)}
                  style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--control-border)", background: "var(--surface-bg)" }}
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        ) : null
      }

      {/* ===== picker modal (t/a only) ===== */}
      {
        canAssignLectures && pickerOpen ? (
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
                background: "var(--surface-bg)",
                borderRadius: 14,
                padding: 14,
                border: "1px solid var(--surface-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div className="card-title">강의 선택</div>
                <button
                  onClick={closePicker}
                  style={{
                    border: "1px solid var(--control-border)",
                    background: "var(--surface-bg)",
                    borderRadius: 10,
                    padding: "6px 10px",
                  }}
                >
                  닫기
                </button>
              </div>

              <div style={{ marginTop: 12, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 10, background: "var(--surface-bg)" }}>
                <div className="card-title">강의 목록</div>
                <input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="강의명 검색"
                  style={{
                    width: "100%",
                    marginTop: 8,
                    padding: "8px 10px",
                    borderRadius: 10,
                    border: "1px solid var(--control-border)",
                  }}
                />
                <div style={{ marginTop: 8, maxHeight: 220, overflow: "auto", display: "grid", gap: 8 }}>
                  {filteredPickerLeafOptions.length === 0 ? (
                    <div style={{ opacity: 0.7 }}>
                      {pickerLeafOptions.length === 0
                        ? "저장된 강의가 없습니다. /lib/lectures 에서 먼저 저장해주세요."
                        : "검색 결과가 없습니다."}
                    </div>
                  ) : (
                    filteredPickerLeafOptions.map((item) => {
                      const leaf = item.leaf;
                      const disabled = usedLeafIds.has(leaf.leafId);
                      return (
                        <button
                          key={`quick:${leaf.id}`}
                          onClick={() => {
                            if (disabled) return;
                            addLectureLeaf(leaf);
                            closePicker();
                          }}
                          disabled={disabled}
                          style={{
                            textAlign: "left",
                            border: "1px solid var(--surface-border)",
                            borderRadius: 10,
                            padding: "8px 10px",
                            background: disabled ? "var(--surface-hover)" : "var(--surface-bg)",
                            opacity: disabled ? 0.6 : 1,
                            cursor: disabled ? "not-allowed" : "pointer",
                          }}
                          title={disabled ? "이미 회차에 포함된 강의입니다(중복 불가)" : "선택하면 회차에 즉시 추가됩니다"}
                        >
                          <div style={{ fontWeight: 700 }}>{leaf.title}</div>
                          <div style={{ opacity: 0.7, marginTop: 2 }}>
                            순서: {leaf.orderKey}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ marginTop: 10, opacity: 0.7 }}>
                • 중복 강의는 추가할 수 없습니다. • 선택 즉시 저장됩니다.
              </div>
            </div>
          </div>
        ) : null
      }
    </section >
  );
}
