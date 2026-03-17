// v1/lib/ui/session/SessionClientCore.tsx
"use client";

import { BROWSER_STORAGE_EVENT, browserStorage } from "@/lib/storage/browserStorage";
import {
  pushSharedSnapshot,
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";
import {
  buildSessionStorageBaseKey,
  sessionLeafIdsKey,
  sessionProgressByLeafIdKey,
  SHARED_LECTURE_TREE_KEY,
  SHARED_DRIVE_ROOT_ID_KEY,
} from "@/lib/storage/sharedStateKeys";
import {
  canAssignSessionLectures,
  canSeeSessionInternalFields,
  type SessionRole,
} from "@/lib/policies/sessionRolePolicy";
import { loadAuthSession } from "@/lib/auth/supabaseAuth";
import { ensureFolder } from "@/lib/integrations/googleDriveSync";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LectureLeafNode,
  LectureTree,
} from "@/lib/types/index";
import {
  loadLectureTree,
  findLeafById,
  flattenLeavesWithContext,
  getFoldersFromTree,
  parseLectureTreeRaw,
} from "@/lib/storage/lectures";

import DriveUploadModal from "@/lib/ui/common/DriveUploadModal";

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
  return { noteDone: false, solveDone: false, noteLink: "", solveLink: "" };
}

function updatedAtMs(tree: LectureTree): number | null {
  const ms = Date.parse(tree.updatedAt ?? "");
  return Number.isFinite(ms) ? ms : null;
}

function leafCount(tree: LectureTree): number {
  return flattenLeavesWithContext(tree).length;
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
  const [noteModal, setNoteModal] = useState<{ leafId: string; title: string } | null>(null);
  const [solveModal, setSolveModal] = useState<{ leafId: string; title: string } | null>(null);

  // 신규 모달 상태
  const [customModal, setCustomModal] = useState<{ title: string; url: string } | null>(null);
  const [noticeModal, setNoticeModal] = useState<{ content: string } | null>(null);

  const [isReordering, setIsReordering] = useState(false);
  const [isHydrating, setIsHydrating] = useState(true); // [V3 추가] 서버 데이터 수신 대기 상태
  const [isSaving, setIsSaving] = useState(false); // [V4 추가] 동기화 중 상태
  const [savingActionName, setSavingActionName] = useState(""); // [V5 추가] 어떤 작업을 저장 중인지 표시

  // tree
  const [tree, setTree] = useState<LectureTree>(() => loadLectureTree());

  // picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSyncing, setPickerSyncing] = useState(false);
  const [selectedPickerFolderId, setSelectedPickerFolderId] = useState<string | null>(null);

  // [버그수정] 내가 직접 쓴 직후 onStorageChanged가 덮어쓰는 것을 방지하는 타임스탬프
  const localWriteTimestampRef = useRef<number>(0);
  const LOCAL_WRITE_GRACE_MS = 2000; // 2초간 외부 스토리지 이벤트 무시

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
      } else {
        // final keys 없으면 비어있는 상태로 시작
        setLectureLeafIds([]);
        setProgressByLeafId({});
        setLastAddedLeafId("");
      }

      // [V2/V3 개선] 초기 로드 시 원격 서버에서 최신 데이터를 강제로 한 번 더 가져옴
      void (async () => {
        try {
          const [remoteIdsRaw, remoteProgRaw, remoteLastRaw] = await Promise.all([
            readRemoteSharedStateKvValue(keyLeafIds(token, sessionIndex)),
            readRemoteSharedStateKvValue(keyProgress(token, sessionIndex)),
            readRemoteSharedStateKvValue(keyLastAdded(token, sessionIndex)),
          ]);

          if (remoteIdsRaw) {
            const ids = JSON.parse(remoteIdsRaw) as string[];
            setLectureLeafIds(ids);
            browserStorage.setItem(keyLeafIds(token, sessionIndex), remoteIdsRaw);
          }
          if (remoteProgRaw) {
            const prog = JSON.parse(remoteProgRaw) as ProgressByLeafId;
            setProgressByLeafId(prog);
            browserStorage.setItem(keyProgress(token, sessionIndex), remoteProgRaw);
          }
          if (remoteLastRaw) {
            setLastAddedLeafId(remoteLastRaw);
            browserStorage.setItem(keyLastAdded(token, sessionIndex), remoteLastRaw);
          }
        } catch (err) {
          console.error("초기 원격 데이터 동기화 실패:", err);
        } finally {
          setIsHydrating(false); // 수신 완료 또는 실패 시 잠금 해제
        }
      })();
    }, 0);
    return () => clearTimeout(id);
  }, [token, sessionIndex]);

  // 구글 드라이브 본진 ID 저장 (전역 공유)
  const [remoteDriveRootId, setRemoteDriveRootId] = useState<string | null>(null);

  useEffect(() => {
    if (!mounted) return;
    void (async () => {
      const val = await readRemoteSharedStateKvValue(SHARED_DRIVE_ROOT_ID_KEY);
      setRemoteDriveRootId(val);
    })();
  }, [mounted]);


  useEffect(() => {
    if (!mounted) return;

    // 다른 기기에서 동기화되어 로컬 스토리지가 바뀌었을 때 UI 갱신
    const onStorageChanged = (e: Event) => {
      const ce = e as CustomEvent<{ key?: string | null; newValue?: string | null }>;
      const key = ce.detail?.key ?? "";
      const newValue = ce.detail?.newValue;

      // [버그수정] 내가 직접 쓴 직후 2초간은 외부 스토리지 이벤트 무시 (레이스 컨디션 방지)
      const isFreshLocalWrite = Date.now() - localWriteTimestampRef.current < LOCAL_WRITE_GRACE_MS;
      if (isFreshLocalWrite) return;

      if (key === keyLeafIds(token, sessionIndex) && newValue) {
        try { setLectureLeafIds(JSON.parse(newValue)); } catch { /* ignore */ }
      } else if (key === keyProgress(token, sessionIndex) && newValue) {
        try { setProgressByLeafId(JSON.parse(newValue)); } catch { /* ignore */ }
      } else if (key === keyLastAdded(token, sessionIndex)) {
        setLastAddedLeafId(newValue ?? "");
      }
    };

    const onLectureTreeUpdated = () => {
      setTree(loadLectureTree());
    };

    window.addEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
    window.addEventListener("tutorweb:lectureTreeUpdated", onLectureTreeUpdated);

    return () => {
      window.removeEventListener(BROWSER_STORAGE_EVENT, onStorageChanged);
      window.removeEventListener("tutorweb:lectureTreeUpdated", onLectureTreeUpdated);
    };
  }, [mounted, token, sessionIndex]);

  // save (관련 상태 변경 시 한꺼번에 저장하여 BROWSER_STORAGE_EVENT 발생 최소화)
  useEffect(() => {
    if (!mounted || isHydrating || isSaving) return; // [V3/V4] 서버 통신 중에는 자동 저장 방지

    // [버그수정] 저장 직전 타임스탬프 기록 → onStorageChanged가 2초간 이 변경을 외부 이벤트로 오해하지 않도록
    localWriteTimestampRef.current = Date.now();

    // 1. 배치(배열) 및 마지막 추가 ID 저장 (t/a 권한 필요)
    if (canAssignLectures) {
      browserStorage.setItem(keyLeafIds(token, sessionIndex), JSON.stringify(lectureLeafIds));
      if (lastAddedLeafId) {
        browserStorage.setItem(keyLastAdded(token, sessionIndex), lastAddedLeafId);
      } else {
        browserStorage.removeItem(keyLastAdded(token, sessionIndex));
      }
    }

    // 2. 진도 정보 저장 (학생 포함 모든 권한 가능)
    if (canEditProgress) {
      browserStorage.setItem(keyProgress(token, sessionIndex), JSON.stringify(progressByLeafId));
    }
  }, [mounted, token, sessionIndex, lectureLeafIds, progressByLeafId, lastAddedLeafId, canAssignLectures, canEditProgress]);

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
    return flattenLeavesWithContext(tree);
  }, [tree]);

  const filteredPickerLeafOptions = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return pickerLeafOptions;
    return pickerLeafOptions.filter((item) => {
      const title = item.leaf.title.toLowerCase();
      const folder = (item.folderTitle ?? "").toLowerCase();
      return title.includes(q) || folder.includes(q);
    });
  }, [pickerLeafOptions, pickerQuery]);

  return (
    <section style={{ marginTop: 12, position: "relative" }}>
      {/* 초기 로딩 및 저장 중 오버레이 */}
      {(isHydrating || isSaving) && (
        <div style={{
          position: "absolute",
          inset: -10,
          background: "rgba(255,255,255,0.4)",
          backdropFilter: "blur(1px)",
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 16,
        }}>
          <div style={{
            padding: "10px 20px",
            background: "var(--surface-bg)",
            border: "1px solid var(--surface-border)",
            borderRadius: 30,
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            fontWeight: 600,
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 10
          }}>
            <div className="spinner" style={{ width: 16, height: 16, border: "2px solid var(--action-primary-bg)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
            {isHydrating ? "최신 데이터를 불러오는 중..." : (savingActionName || "변경 사항을 적용하는 중...")}
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div className="card-title">오늘의 학습</div>
      </div>

      {headerSlot ? <div style={{ marginTop: 8 }}>{headerSlot}</div> : null}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 8 }}>
        <div />
        {canAssignLectures ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={async () => {
                if (isReordering) {
                  // 완료 시점에 강제 저장 후 종료
                  setSavingActionName("변경 사항을 저장하는 중...");
                  setIsSaving(true);
                  try {
                    await pushSharedSnapshot({
                      stateKv: {
                        [keyLeafIds(token, sessionIndex)]: JSON.stringify(lectureLeafIds),
                        [keyLastAdded(token, sessionIndex)]: lastAddedLeafId,
                      },
                    });
                  } catch (err) {
                    console.error("순서 변경 저장 실패:", err);
                  } finally {
                    setIsSaving(false);
                    setSavingActionName("");
                    setIsReordering(false);
                  }
                } else {
                  setIsReordering(true);
                }
              }}
              disabled={isHydrating || isSaving}
              className="btn btn-black"
              style={{
                padding: "6px 12px",
                background: isReordering ? "var(--action-primary-bg)" : "var(--color-bg)",
                border: `1px solid ${isReordering ? "var(--action-primary-border)" : "var(--control-border)"}`,
                color: isReordering ? "var(--action-contrast-text)" : "var(--text-main)",
                fontWeight: isReordering ? 700 : 400,
                minWidth: 90,
              }}
            >
              {isSaving ? "변경 중..." : isReordering ? "순서 완료" : "순서 변경"}
            </button>
            <button
              onClick={() => setNoticeModal({ content: "" })}
              disabled={isHydrating || isSaving}
              className="btn btn-black"
              style={{ padding: "6px 12px", background: "var(--color-bg)", border: "1px solid var(--control-border)", color: "var(--text-main)" }}
            >
              + 공지
            </button>
            <button
              onClick={() => setCustomModal({ title: "", url: "" })}
              disabled={isHydrating || isSaving}
              className="btn btn-black"
              style={{ padding: "6px 12px", background: "var(--color-bg)", border: "1px solid var(--control-border)", color: "var(--text-main)" }}
            >
              + 문제 추가
            </button>
            <button onClick={() => void openPicker()} className="btn btn-black" disabled={isHydrating || isSaving || pickerSyncing}>
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
          const isCustom = leafId.startsWith("custom_");
          const targetProblemUrl = isCustom ? (p.customProblemUrl || "") : problemUrl;
          const noteLocked = !!p.noteDone;
          const solveLocked = !!p.solveDone;
          const canOpenLecture = !!lectureUrl && !noteLocked;
          const canOpenProblem = isCustom ? !!targetProblemUrl : (!!problemUrl && noteLocked);
          const canSubmitNote = !noteLocked;
          const canSubmitSolveFinal = isCustom ? !solveLocked : (noteLocked && !solveLocked); 

          return (
            <div
              key={leafId}
              style={{
                display: "flex",
                alignItems: "stretch",
                gap: 12,
              }}
            >
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
                        p.noticeContent || "내용 없음"
                      ) : leafId.startsWith("custom_") ? (
                        p.customTitle || "제목 없는 문제"
                      ) : (
                        leaf?.title ?? "(삭제되었거나 찾을 수 없는 강의)"
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
                        onClick={async () => {
                          const ok = window.confirm("이 강의를 이 회차에서 삭제할까요?");
                          if (!ok) return;

                          setSavingActionName("강의를 삭제하는 중...");
                          setIsSaving(true);
                          try {
                            const nextIds = lectureLeafIds.filter((id) => id !== leafId);
                            const nextProg = { ...progressByLeafId };
                            delete nextProg[leafId];

                            // lastAddedLeafId 보정
                            const nextLastAdded = lastAddedLeafId === leafId
                              ? (nextIds.length ? nextIds[nextIds.length - 1] : "")
                              : lastAddedLeafId;

                            await pushSharedSnapshot({
                              stateKv: {
                                [keyLeafIds(token, sessionIndex)]: JSON.stringify(nextIds),
                                [keyProgress(token, sessionIndex)]: JSON.stringify(nextProg),
                                [keyLastAdded(token, sessionIndex)]: nextLastAdded,
                              },
                            });

                            setLectureLeafIds(nextIds);
                            setProgressByLeafId(nextProg);
                            setLastAddedLeafId(nextLastAdded);
                          } catch (err) {
                            console.error("삭제 실패:", err);
                            window.alert("삭제에 실패했습니다.");
                          } finally {
                            setIsSaving(false);
                            setSavingActionName("");
                          }
                        }}
                        disabled={isSaving}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--control-border)",
                          background: "var(--surface-bg)",
                          cursor: isSaving ? "not-allowed" : "pointer",
                          height: 32,
                          fontWeight: 500,
                          opacity: isSaving ? 0.6 : 1,
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
                      // 1. 스타일 결정 로직 (원장님 가이드 반영)
                      // - 주황(Active): 현재 해야 할 단계
                      // - 파랑(Done): 완료된 단계
                      // - 회색(Locked): 아직 못 가는 단계
                      
                      const activeStyle = { bg: "var(--status-active-bg)", border: "var(--status-active-border)", text: "var(--status-active-text)" };
                      const doneStyle = { bg: "var(--status-done-bg)", border: "var(--status-done-border)", text: "var(--status-done-text)" };
                      const lockedStyle = { bg: "var(--status-locked-bg)", border: "var(--status-locked-border)", text: "var(--status-locked-text)" };

                      // 강의 & 필기 버튼 스타일
                      const lectureNoteStatus = noteLocked ? doneStyle : activeStyle;

                      // 문제 & 풀이 버튼 스타일
                      let problemSolveStatus = lockedStyle;
                      if (isCustom) {
                        problemSolveStatus = solveLocked ? doneStyle : activeStyle;
                      } else {
                        if (solveLocked) problemSolveStatus = doneStyle;
                        else if (noteLocked) problemSolveStatus = activeStyle;
                      }

                      const lectureStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${lectureNoteStatus.border} !important`,
                        background: `${lectureNoteStatus.bg} !important`,
                        color: `${lectureNoteStatus.text} !important`,
                        cursor: canOpenLecture ? "pointer" : "not-allowed",
                        fontWeight: 700,
                      } as const;

                      const noteStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${lectureNoteStatus.border} !important`,
                        background: `${lectureNoteStatus.bg} !important`,
                        color: `${lectureNoteStatus.text} !important`,
                        cursor: canSubmitNote ? "pointer" : "not-allowed",
                        fontWeight: 700,
                      } as const;

                      const problemStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${problemSolveStatus.border} !important`,
                        background: `${problemSolveStatus.bg} !important`,
                        color: `${problemSolveStatus.text} !important`,
                        cursor: isCustom ? (targetProblemUrl ? "pointer" : "not-allowed") : (canOpenProblem ? "pointer" : "not-allowed"),
                        fontWeight: 700,
                      } as const;

                      const solveStyle = {
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: `1px solid ${problemSolveStatus.border} !important`,
                        background: `${problemSolveStatus.bg} !important`,
                        color: `${problemSolveStatus.text} !important`,
                        cursor: isCustom ? (!solveLocked ? "pointer" : "not-allowed") : (canSubmitSolveFinal ? "pointer" : "not-allowed"),
                        fontWeight: 700,
                      } as const;

                      return (
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "grid", gridTemplateColumns: isCustom ? "repeat(2, minmax(90px, 1fr))" : "repeat(4, minmax(90px, 1fr))", gap: 8, alignItems: "center" }}>
                            {!isCustom && (
                              <button
                                onClick={() => {
                                  if (!lectureUrl) return;
                                  if (noteLocked) return;
                                  window.open(lectureUrl, "_blank", "noopener,noreferrer");
                                }}
                                disabled={!canOpenLecture}
                                style={lectureStyle}
                              >
                                강의
                              </button>
                            )}

                            {!isCustom && (
                              <div style={{ position: "relative", width: "100%" }}>
                                {noteLocked ? (
                                  <div style={{
                                    ...noteStyle,
                                    cursor: "default",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                  }}>
                                    <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 700 }}>필기 제출 완료</span>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => {
                                      if (!canSubmitNote) return;
                                    const leaf = getLeaf(leafId);
                                    const modalTitle = isCustom ? (p.customTitle || "문제 풀이") : (leaf?.title || "필기 제출");
                                    setNoteModal({ leafId, title: modalTitle });
                                    }}
                                    disabled={!canSubmitNote}
                                    style={{ ...noteStyle, width: "100%" }}
                                  >
                                    필기 제출
                                  </button>
                                )}
                              </div>
                            )}

                            <button
                              onClick={() => {
                                if (!targetProblemUrl) return;
                                if (!canOpenProblem) return;
                                window.open(targetProblemUrl, "_blank", "noopener,noreferrer");
                              }}
                              disabled={!canOpenProblem}
                              style={problemStyle}
                            >
                              문제
                            </button>

                            <div style={{ position: "relative", width: "100%" }}>
                              {solveLocked ? (
                                <div style={{
                                  ...solveStyle,
                                  cursor: "default",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center"
                                }}>
                                  <span style={{ fontSize: 13, lineHeight: 1, fontWeight: 700 }}>풀이 제출 완료</span>
                                </div>
                              ) : (
                                <button
                                  onClick={() => {
                                    // For custom problems, canSubmitSolveFinal is always true if not solveLocked
                                    if (!isCustom && !canSubmitSolveFinal) return;
                                    const leaf = getLeaf(leafId);
                                    const modalTitle = isCustom ? (p.customTitle || "문제 풀이") : (leaf?.title || "풀이 제출");
                                    setSolveModal({ leafId, title: modalTitle });
                                  }}
                                  disabled={isCustom ? solveLocked : !canSubmitSolveFinal}
                                  style={{ ...solveStyle, width: "100%" }}
                                >
                                  풀이 제출
                                </button>
                              )}
                            </div>
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

                    {canSeeInternalFields && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
                        {/* 필기 섹션 (커스텀 문제는 제외) */}
                        {!isCustom && p.noteDone && (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button
                              onClick={() => p.noteLink && window.open(p.noteLink, "_blank")}
                              style={{ padding: "6px 12px", borderRadius: 8, background: "var(--surface-hover)", border: "1px solid var(--surface-border)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              📂 필기 폴더 바로가기
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm("이 학생의 필기 제출을 초기화하고 다시 제출하게 할까요?")) {
                                  updateProgress(leafId, { noteDone: false, noteLink: "" });
                                }
                              }}
                              style={{ padding: "6px 12px", borderRadius: 8, background: "#fee2e2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              필기 초기화
                            </button>
                          </div>
                        )}

                        {/* 풀이 섹션 */}
                        {p.solveDone && (
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <button
                              onClick={() => p.solveLink && window.open(p.solveLink, "_blank")}
                              style={{ padding: "6px 12px", borderRadius: 8, background: "var(--surface-hover)", border: "1px solid var(--surface-border)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              📂 풀이 폴더 바로가기
                            </button>
                            <button
                              onClick={() => {
                                if (window.confirm("이 학생의 풀이 제출을 초기화하고 다시 제출하게 할까요?")) {
                                  updateProgress(leafId, { solveDone: false, solveLink: "" });
                                }
                              }}
                              style={{ padding: "6px 12px", borderRadius: 8, background: "#fee2e2", border: "1px solid #fecaca", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                            >
                              풀이 초기화
                            </button>
                          </div>
                        )}
                      </div>
                    )}
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
      </div>

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
                  onClick={async () => {
                    const titleStr = customModal?.title || ''.trim() || "제목 없는 문제";
                    const urlStr = customModal?.url || ''.trim();

                    const randId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
                    const leafId = `custom_${randId}`;

                    setSavingActionName("문제를 추가하는 중...");
                    setIsSaving(true);
                    try {
                      const nextIds = [...lectureLeafIds, leafId];
                      const nextProg = {
                        ...progressByLeafId,
                        [leafId]: { ...defaultProgress(), customTitle: titleStr, customProblemUrl: urlStr },
                      };

                      await pushSharedSnapshot({
                        stateKv: {
                          [keyLeafIds(token, sessionIndex)]: JSON.stringify(nextIds),
                          [keyProgress(token, sessionIndex)]: JSON.stringify(nextProg),
                          [keyLastAdded(token, sessionIndex)]: leafId,
                        },
                      });

                      setLectureLeafIds(nextIds);
                      setProgressByLeafId(nextProg);
                      setLastAddedLeafId(leafId);
                      setCustomModal(null);
                    } catch (err) {
                      console.error("문제 추가 실패:", err);
                      window.alert("저장에 실패했습니다. 다시 시도해주세요.");
                    } finally {
                      setIsSaving(false);
                      setSavingActionName("");
                    }
                  }}
                  disabled={isSaving}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--action-primary-border)",
                    background: "var(--action-primary-bg)",
                    color: "var(--action-contrast-text)",
                    fontWeight: 600,
                    minWidth: 90,
                  }}
                >
                  {isSaving ? "적용 중..." : "문제 추가"}
                </button>
                <button
                  onClick={() => setCustomModal(null)}
                  disabled={isSaving}
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
                  onClick={async () => {
                    const contentStr = noticeModal?.content || ''.trim();
                    if (!contentStr) {
                      window.alert("내용을 입력해주세요.");
                      return;
                    }

                    const randId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
                    const leafId = `notice_${randId}`;

                    setSavingActionName("공지를 등록하는 중...");
                    setIsSaving(true);
                    try {
                      const nextIds = [...lectureLeafIds, leafId];
                      const nextProg = {
                        ...progressByLeafId,
                        [leafId]: { ...defaultProgress(), noticeContent: contentStr },
                      };

                      await pushSharedSnapshot({
                        stateKv: {
                          [keyLeafIds(token, sessionIndex)]: JSON.stringify(nextIds),
                          [keyProgress(token, sessionIndex)]: JSON.stringify(nextProg),
                          [keyLastAdded(token, sessionIndex)]: leafId,
                        },
                      });

                      setLectureLeafIds(nextIds);
                      setProgressByLeafId(nextProg);
                      setLastAddedLeafId(leafId);
                      setNoticeModal(null);
                    } catch (err) {
                      console.error("공지 등록 실패:", err);
                      window.alert("저장에 실패했습니다.");
                    } finally {
                      setIsSaving(false);
                      setSavingActionName("");
                    }
                  }}
                  disabled={isSaving}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--action-primary-border)",
                    background: "var(--action-primary-bg)",
                    color: "var(--action-contrast-text)",
                    fontWeight: 600,
                    minWidth: 90,
                  }}
                >
                  {isSaving ? "적용 중..." : "공지 등록"}
                </button>
                <button
                  onClick={() => setNoticeModal(null)}
                  disabled={isSaving}
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
                width: "min(760px, 100%)",
                maxHeight: "85vh",
                overflow: "auto",
                background: "var(--surface-bg)",
                borderRadius: 14,
                padding: 16,
                border: "1px solid var(--surface-border)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div className="card-title">강의 선택</div>
                <button
                  onClick={closePicker}
                  style={{ border: "1px solid var(--control-border)", background: "var(--surface-bg)", borderRadius: 10, padding: "6px 10px" }}
                >
                  닫기
                </button>
              </div>

              {/* 폴더 + 강의 2단계 레이아웃 */}
              <div style={{ display: "grid", gridTemplateColumns: selectedPickerFolderId ? "180px minmax(0,1fr)" : "1fr", gap: 12 }}>
                {/* 좌측: 폴더 목록 */}
                <div style={{ border: "1px solid var(--surface-border)", borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "8px 12px", background: "var(--surface-hover)", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--surface-border)" }}>
                    폴더 선택
                  </div>
                  <div style={{ padding: 6, display: "grid", gap: 4, maxHeight: 300, overflow: "auto" }}>
                    {getFoldersFromTree(tree).length === 0 ? (
                      <div style={{ padding: 8, fontSize: 13, color: "var(--text-muted)" }}>
                        폴더가 없습니다. 강의 저장소에서 먼저 추가해주세요.
                      </div>
                    ) : (
                      getFoldersFromTree(tree).map((folder) => {
                        const isSelected = folder.id === selectedPickerFolderId;
                        const leafCount = (folder.children ?? []).filter((c) => c.type === "leaf").length;
                        return (
                          <button
                            key={folder.id}
                            onClick={() => {
                              setSelectedPickerFolderId(isSelected ? null : folder.id);
                              setPickerQuery("");
                            }}
                            style={{
                              textAlign: "left",
                              padding: "8px 10px",
                              borderRadius: 8,
                              border: isSelected ? "1px solid var(--surface-selected-border)" : "1px solid transparent",
                              background: isSelected ? "var(--surface-selected-bg)" : "transparent",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ fontWeight: 500, fontSize: 13 }}>📁 {folder.title}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>강의 {leafCount}개</div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* 우측: 강의 목록 (폴더 선택 시만) */}
                {selectedPickerFolderId && (
                  <div style={{ border: "1px solid var(--surface-border)", borderRadius: 12, overflow: "hidden" }}>
                    <div style={{ padding: "8px 12px", background: "var(--surface-hover)", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--surface-border)" }}>
                      강의 선택
                    </div>
                    <div style={{ padding: 8 }}>
                      <input
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        placeholder="강의명 검색"
                        style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: "1px solid var(--control-border)", fontSize: 13, marginBottom: 8 }}
                        autoFocus
                      />
                      <div style={{ maxHeight: 240, overflow: "auto", display: "grid", gap: 6 }}>
                        {filteredPickerLeafOptions.filter((item) => item.folderId === selectedPickerFolderId).length === 0 ? (
                          <div style={{ padding: 8, fontSize: 13, color: "var(--text-muted)" }}>
                            {pickerQuery ? "검색 결과가 없습니다." : "이 폴더에 강의가 없습니다."}
                          </div>
                        ) : (
                          filteredPickerLeafOptions
                            .filter((item) => item.folderId === selectedPickerFolderId)
                            .map((item) => {
                              const leaf = item.leaf;
                              const disabled = usedLeafIds.has(leaf.leafId);
                              return (
                                <button
                                  key={`quick:${leaf.id}`}
                                  onClick={async () => {
                                    if (disabled || isSaving) return;
                                    
                                    setSavingActionName("강의를 추가하는 중...");
                                    setIsSaving(true);
                                    try {
                                      const nextIds = [...lectureLeafIds, leaf.leafId];
                                      const nextProg = {
                                        ...progressByLeafId,
                                        [leaf.leafId]: progressByLeafId[leaf.leafId] ?? defaultProgress(),
                                      };

                                      await pushSharedSnapshot({
                                        stateKv: {
                                          [keyLeafIds(token, sessionIndex)]: JSON.stringify(nextIds),
                                          [keyProgress(token, sessionIndex)]: JSON.stringify(nextProg),
                                          [keyLastAdded(token, sessionIndex)]: leaf.leafId,
                                        },
                                      });

                                      setLectureLeafIds(nextIds);
                                      setProgressByLeafId(nextProg);
                                      setLastAddedLeafId(leaf.leafId);
                                      closePicker();
                                    } catch (err) {
                                      console.error("강의 추가 실패:", err);
                                      window.alert("저장에 실패했습니다.");
                                    } finally {
                                      setIsSaving(false);
                                      setSavingActionName("");
                                    }
                                  }}
                                  disabled={disabled || isSaving}
                                  style={{
                                    textAlign: "left",
                                    border: "1px solid var(--surface-border)",
                                    borderRadius: 8,
                                    padding: "8px 10px",
                                    background: disabled ? "var(--surface-hover)" : "var(--surface-bg)",
                                    opacity: disabled ? 0.6 : 1,
                                    cursor: disabled ? "not-allowed" : "pointer",
                                  }}
                                  title={disabled ? "이미 회차에 포함된 강의입니다(중복 불가)" : "선택하면 즉시 추가됩니다"}
                                >
                                  <div style={{ fontWeight: 600, fontSize: 13 }}>{leaf.title}</div>
                                  {leaf.lectureUrl && (
                                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {leaf.lectureUrl}
                                    </div>
                                  )}
                                  {disabled && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>이미 추가됨</div>}
                                </button>
                              );
                            })
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
                • 폴더를 먼저 선택하면 안의 강의가 나타납니다. • 중복 강의는 추가할 수 없습니다.
              </div>
            </div>
          </div>
        ) : null
      }
        {/* 구글 드라이브 업로드 모달 (필기) */}
      <DriveUploadModal
        open={!!noteModal}
        token={token}
        sessionIndex={sessionIndex}
        contentTitle={noteModal?.title || ""}
        submitType="필기 제출"
        initialValue="" 
        rootFolderId={remoteDriveRootId}
        onClose={() => setNoteModal(null)}
        onComplete={async (driveLink) => {
          if (!noteModal) return;
          const { leafId } = noteModal;
          
          setSavingActionName("필기 제출을 확정하는 중...");
          setIsSaving(true);
          try {
            const nextProg = {
              ...progressByLeafId,
              [leafId]: {
                ...(progressByLeafId[leafId] || defaultProgress()),
                noteDone: true,
                noteLink: driveLink,
              }
            };
            
            await pushSharedSnapshot({
              stateKv: {
                [keyProgress(token, sessionIndex)]: JSON.stringify(nextProg),
              },
            });
            setProgressByLeafId(nextProg);
            setNoteModal(null);
          } catch (err) {
            console.error("필기 제출 저장 실패:", err);
            window.alert("제출 기록 저장에 실패했습니다.");
          } finally {
            setIsSaving(false);
            setSavingActionName("");
          }
        }}
      />

      {/* 구글 드라이브 업로드 모달 (풀이) */}
      <DriveUploadModal
        open={!!solveModal}
        token={token}
        sessionIndex={sessionIndex}
        contentTitle={solveModal?.title || ""}
        submitType="풀이 제출"
        initialValue=""
        rootFolderId={remoteDriveRootId}
        onClose={() => setSolveModal(null)}
        onComplete={async (driveLink) => {
          if (!solveModal) return;
          const { leafId } = solveModal;

          setSavingActionName("풀이 제출을 확정하는 중...");
          setIsSaving(true);
          try {
            const nextProg = {
              ...progressByLeafId,
              [leafId]: {
                ...(progressByLeafId[leafId] || defaultProgress()),
                solveDone: true,
                solveLink: driveLink,
              }
            };

            await pushSharedSnapshot({
              stateKv: {
                [keyProgress(token, sessionIndex)]: JSON.stringify(nextProg),
              },
            });
            setProgressByLeafId(nextProg);
            setSolveModal(null);
          } catch (err) {
            console.error("풀이 제출 저장 실패:", err);
            window.alert("제출 기록 저장에 실패했습니다.");
          } finally {
            setIsSaving(false);
            setSavingActionName("");
          }
        }}
      />

      {/* 기존 모달들 하단에 유지 (필요시) */}
      {/* 긴급 복구 UI (숨겨진 모드) */}
      {(() => {
        const isRescueMode = typeof window !== "undefined" && window.location.search.includes("rescue=true");
        if (!isRescueMode) return null;

        const exportLocalData = () => {
          const keys = ["tutorweb_sessions_v1", "tutorweb_students_v1", "tutorweb_teachers_v1"];
          const exportData: Record<string, string | null> = {};
          keys.forEach(k => { exportData[k] = localStorage.getItem(k); });
          
          // 추가로 모든 mk3:* (진도 정보 및 세션 데이터) 추출
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k?.startsWith("mk3:")) {
              exportData[k] = localStorage.getItem(k);
            }
          }
          
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `tutorweb_rescue_admin_${new Date().getTime()}.json`;
          a.click();
          
          const jsonStr = JSON.stringify(exportData);
          navigator.clipboard.writeText(jsonStr).then(() => {
            window.alert("📦 로컬 데이터가 성공적으로 추출되었습니다!\n\n클립보드에도 복사되었습니다. 이 내용을 저에게 붙여넣어 주세요.");
          });
        };

        return (
          <div style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 9999,
            padding: 20,
            background: "#ff4d4f",
            color: "white",
            borderRadius: 20,
            boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            border: "4px solid white"
          }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>🚀 긴급 데이터 구조 모드 (Admin)</div>
            <p style={{ fontSize: 12, opacity: 0.9 }}>패드에 남은 시헌이의 소중한 기록을 안전하게 구출합니다.</p>
            
            <div style={{ background: "rgba(0,0,0,0.2)", padding: 10, borderRadius: 10 }}>
              <div style={{ fontSize: 10, marginBottom: 5, color: "#fff" }}>현재 화면에 보이는 데이터 (복사해서 브레인에게 주세요):</div>
              <textarea 
                readOnly
                value={JSON.stringify({
                  token,
                  sessionIndex,
                  lectureLeafIds,
                  progressByLeafId
                }, null, 2)}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                style={{ width: "100%", height: "80px", fontSize: "10px", color: "#000", borderRadius: 5, padding: 5, fontFamily: "monospace" }}
              />
            </div>

            <button 
              onClick={exportLocalData}
              style={{
                padding: "12px",
                background: "white",
                color: "#ff4d4f",
                border: "none",
                borderRadius: 12,
                fontWeight: 900,
                cursor: "pointer"
              }}
            >
              전체 스토리지 파일로 추출하기
            </button>
          </div>
        );
      })()}
    </section>
  );
}
