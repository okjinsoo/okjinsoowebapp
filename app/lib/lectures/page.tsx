"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LectureLeafNode } from "@/lib/types/index";
import {
  createLectureLeaf,
  flattenLeaves,
  loadLectureCatalog,
  loadLectureTree,
  parseLectureTreeRaw,
  saveLectureCatalog,
} from "@/lib/storage/lectures";
import {
  pullSharedSnapshotAndHydrateWithOptions,
  pushSharedSnapshot,
  readRemoteSharedStateKvValue,
} from "@/lib/storage/sharedSnapshot";

const LECTURE_TREE_KEY = "mk3:lectureTree";
const DB_SYNC_DEBOUNCE_MS = 500;

function firstProblemUrl(leaf: LectureLeafNode): string {
  return leaf.problemUrls?.[0] ?? "";
}

export default function LecturesPage() {
  const [lectures, setLectures] = useState<LectureLeafNode[]>(() => loadLectureCatalog());
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [dbSyncing, setDbSyncing] = useState(false);
  const [dbSyncError, setDbSyncError] = useState<string | null>(null);
  const dbSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeLeafId = useMemo(() => {
    if (selectedLeafId && lectures.some((leaf) => leaf.leafId === selectedLeafId)) return selectedLeafId;
    return lectures[0]?.leafId ?? null;
  }, [lectures, selectedLeafId]);

  const selectedLecture = useMemo(
    () => lectures.find((leaf) => leaf.leafId === activeLeafId) ?? null,
    [activeLeafId, lectures]
  );

  const filteredLectures = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lectures;
    return lectures.filter((leaf) => {
      const title = (leaf.title ?? "").toLowerCase();
      const lectureUrl = (leaf.lectureUrl ?? "").toLowerCase();
      const problemUrl = firstProblemUrl(leaf).toLowerCase();
      return title.includes(q) || lectureUrl.includes(q) || problemUrl.includes(q);
    });
  }, [lectures, query]);

  async function loadFromRemoteSnapshot() {
    setDbSyncing(true);
    setDbSyncError(null);
    try {
      await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
      const localTree = loadLectureTree();
      setLectures(loadLectureCatalog());

      // DB에 과거 "빈 강의 트리"가 남아 있으면, 현재 로컬의 실제 강의 목록으로 1회 자동 복구
      const remoteRaw = await readRemoteSharedStateKvValue(LECTURE_TREE_KEY);
      const remoteTree = parseLectureTreeRaw(remoteRaw);
      const localCount = flattenLeaves(localTree, { sortByOrderKey: false }).length;
      const remoteCount = flattenLeaves(remoteTree, { sortByOrderKey: false }).length;
      if (localCount > 0 && remoteCount === 0) {
        const result = await pushSharedSnapshot({
          stateKv: {
            [LECTURE_TREE_KEY]: JSON.stringify(localTree),
          },
        });
        if (!result.stateKvSynced) {
          throw new Error("state_kv sync failed");
        }
      }
    } catch (err) {
      console.error("강의 저장소 원격 불러오기 실패:", err);
      setDbSyncError("DB에서 강의 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setDbSyncing(false);
    }
  }

  async function pushLectureTreeToDbNow() {
    setDbSyncing(true);
    setDbSyncError(null);
    try {
      const rawTree = JSON.stringify(loadLectureTree());
      const result = await pushSharedSnapshot({
        stateKv: {
          [LECTURE_TREE_KEY]: rawTree,
        },
      });
      if (!result.stateKvSynced) {
        throw new Error("state_kv sync failed");
      }
    } catch (err) {
      console.error("강의 저장소 원격 저장 실패:", err);
      setDbSyncError("DB 저장에 실패했어요. 인터넷 상태를 확인하고 다시 시도해주세요.");
    } finally {
      setDbSyncing(false);
    }
  }

  function scheduleDbSync() {
    if (dbSyncTimerRef.current) clearTimeout(dbSyncTimerRef.current);
    dbSyncTimerRef.current = setTimeout(() => {
      void pushLectureTreeToDbNow();
    }, DB_SYNC_DEBOUNCE_MS);
  }

  useEffect(() => {
    const id = setTimeout(() => {
      void loadFromRemoteSnapshot();
    }, 0);
    return () => {
      clearTimeout(id);
      if (dbSyncTimerRef.current) {
        clearTimeout(dbSyncTimerRef.current);
        // 페이지를 바로 이동해도 마지막 변경을 DB에 남기기 위해 즉시 1회 동기화
        void pushLectureTreeToDbNow();
        dbSyncTimerRef.current = null;
      }
    };
  }, []);

  function persist(next: LectureLeafNode[]) {
    const saved = saveLectureCatalog(next);
    setLectures(saved);
    scheduleDbSync();
  }

  function addLecture() {
    const title = newTitle.trim();
    if (!title) {
      window.alert("강의 제목을 입력해주세요.");
      return;
    }

    const created = createLectureLeaf({ title });
    const next = [...lectures, created];
    persist(next);
    setSelectedLeafId(created.leafId);
    setNewTitle("");
  }

  function patchSelected(args: { title?: string; lectureUrl?: string; problemUrl?: string }) {
    if (!activeLeafId) return;
    const next = lectures.map((leaf) => {
      if (leaf.leafId !== activeLeafId) return leaf;
      return {
        ...leaf,
        title: typeof args.title === "string" ? args.title : leaf.title,
        lectureUrl: typeof args.lectureUrl === "string" ? args.lectureUrl : leaf.lectureUrl,
        problemUrls:
          typeof args.problemUrl === "string" ? [args.problemUrl] : [firstProblemUrl(leaf)],
      };
    });
    persist(next);
  }

  function removeSelected() {
    if (!selectedLecture) return;
    const ok = window.confirm(`"${selectedLecture.title || "제목 없는 강의"}" 강의를 삭제할까요?`);
    if (!ok) return;

    const next = lectures.filter((leaf) => leaf.leafId !== selectedLecture.leafId);
    persist(next);
  }

  function moveSelected(offset: -1 | 1) {
    if (!selectedLecture) return;
    const idx = lectures.findIndex((leaf) => leaf.leafId === selectedLecture.leafId);
    if (idx < 0) return;

    const nextIdx = idx + offset;
    if (nextIdx < 0 || nextIdx >= lectures.length) return;

    const next = [...lectures];
    const tmp = next[idx];
    next[idx] = next[nextIdx];
    next[nextIdx] = tmp;
    persist(next);
    setSelectedLeafId(tmp.leafId);
  }

  return (
    <div className="p-6 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">강의 저장소 (재개편)</h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            DB 우선으로 동작합니다. 복잡한 폴더 구조는 제거했습니다.
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            {dbSyncing ? "DB 동기화 중..." : dbSyncError ? dbSyncError : "DB 동기화 정상"}
          </p>
        </div>
      </header>

      <div
        className="rounded-2xl border p-3 flex flex-wrap items-center gap-2"
        style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
      >
        <input
          className="flex-1 min-w-[220px] rounded-lg border px-3 py-2 text-sm"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            e.preventDefault();
            addLecture();
          }}
          placeholder="새 강의 제목"
        />
        <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={addLecture}>
          강의 추가
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section
          className="rounded-2xl border overflow-hidden"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
        >
          <div
            className="px-4 py-3 border-b text-sm font-semibold"
            style={{ borderColor: "var(--surface-border)", background: "var(--surface-hover)" }}
          >
            강의 목록
          </div>
          <div className="p-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="제목/링크 검색"
            />
          </div>

          <div className="max-h-[64vh] overflow-y-auto p-2 space-y-1">
            {filteredLectures.length === 0 ? (
              <div className="px-2 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                {lectures.length === 0 ? "저장된 강의가 없습니다." : "검색 결과가 없습니다."}
              </div>
            ) : (
              filteredLectures.map((leaf, idx) => {
                const selected = leaf.leafId === selectedLeafId;
                return (
                  <button
                    key={leaf.leafId}
                    className="w-full text-left rounded-lg px-3 py-2 border"
                    style={{
                      background: selected ? "var(--surface-selected-bg)" : "var(--surface-bg)",
                      borderColor: selected ? "var(--surface-selected-border)" : "transparent",
                    }}
                    onMouseEnter={(e) => {
                      if (selected) return;
                      e.currentTarget.style.background = "var(--surface-hover)";
                    }}
                    onMouseLeave={(e) => {
                      if (selected) return;
                      e.currentTarget.style.background = "var(--surface-bg)";
                    }}
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

        <section
          className="rounded-2xl border p-4 space-y-4"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
        >
          <div className="text-sm font-semibold">강의 상세</div>

          {!selectedLecture ? (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>왼쪽에서 강의를 선택해주세요.</div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>강의 제목</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={selectedLecture.title}
                  onChange={(e) => patchSelected({ title: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>강의 URL</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={selectedLecture.lectureUrl ?? ""}
                  onChange={(e) => patchSelected({ lectureUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs" style={{ color: "var(--text-muted)" }}>문제 URL</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  value={firstProblemUrl(selectedLecture)}
                  onChange={(e) => patchSelected({ problemUrl: e.target.value })}
                  placeholder="https://..."
                />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => moveSelected(-1)}>
                  위로
                </button>
                <button className="px-3 py-2 rounded-lg border text-sm btn-white" onClick={() => moveSelected(1)}>
                  아래로
                </button>
                <button className="px-3 py-2 rounded-lg border text-sm text-red-600 btn-white" onClick={removeSelected}>
                  삭제
                </button>
              </div>

              <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                강의 수정 내용은 자동 저장되며, 회차 상세의 &quot;강의 추가&quot; 목록에 바로 반영됩니다.
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
