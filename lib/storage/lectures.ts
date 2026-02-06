// v1/lib/storage/lectures.ts
"use client";

import type {
  LectureTree,
  LectureNode,
  LectureFolderNode,
  LectureLeafNode,
  LectureLeafId,
  LectureNodeId,
} from "@/lib/types/index";

/**
 * ✅ 강의 저장소(localStorage) 키
 * - 트리 전체를 1개로 저장합니다.
 */
const KEY_LECTURE_TREE = "mk3:lectureTree";

/**
 * ✅ (레거시) 회차 강의 item 키
 * - 기존 UI가 의존하고 있을 수 있어 당분간 유지합니다.
 * - 추후 Session.lectureLeafIds 기반으로 정리할 예정.
 */
function legacyItemsKey(token: string, sessionIndex: number) {
  return `mk3:${token}:session:${sessionIndex}:items`;
}

// -------------------- helpers --------------------

function nowIso() {
  return new Date().toISOString();
}

function makeId(): string {
  // 브라우저 환경 우선
  if (typeof crypto !== "undefined") {
    // randomUUID가 있으면 최우선
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    // getRandomValues로 fallback
    if (typeof crypto.getRandomValues === "function") {
      const buf = new Uint32Array(4);
      crypto.getRandomValues(buf);
      return Array.from(buf, (x) => x.toString(16).padStart(8, "0")).join("");
    }
  }
  // 최후 fallback
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function padOrder(n: number, width = 6) {
  return String(n).padStart(width, "0");
}

function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 루트 트리 기본값
 * - 과목별 성격이 다르므로, 루트 밑은 빈 폴더로 시작합니다.
 */
export function makeEmptyLectureTree(): LectureTree {
  const rootId = makeId();
  const t: LectureTree = {
    version: 1,
    updatedAt: nowIso(),
    root: {
      id: rootId,
      type: "folder",
      title: "강의 저장소",
      createdAt: nowIso(),
      children: [],
    },
  };
  return t;
}

// -------------------- core load/save --------------------

export function loadLectureTree(): LectureTree {
  const raw =
    typeof window !== "undefined" ? window.localStorage.getItem(KEY_LECTURE_TREE) : null;
  const parsed = safeParseJson<LectureTree>(raw);

  // 없으면 기본 트리 생성
  if (!parsed || !parsed.root || parsed.root.type !== "folder") {
    const fresh = makeEmptyLectureTree();
    saveLectureTree(fresh);
    return fresh;
  }

  return parsed;
}

export function saveLectureTree(tree: LectureTree): LectureTree {
  const next: LectureTree = {
    ...tree,
    version: 1,
    updatedAt: nowIso(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY_LECTURE_TREE, JSON.stringify(next));
  }
  return next;
}

/**
 * 편집 모드에서 드래그/편집이 끝난 뒤 "저장"을 누를 때 호출하는 함수
 * - 트리를 저장하기 전에 leaf들의 orderKey를 전체(B 방식) 순서대로 재부여합니다.
 */
export function saveLectureTreeWithReindex(tree: LectureTree): LectureTree {
  const re = reindexOrderKeys(tree);
  return saveLectureTree(re);
}

// -------------------- find utilities --------------------

export function isFolder(node: LectureNode): node is LectureFolderNode {
  return node.type === "folder";
}
export function isLeaf(node: LectureNode): node is LectureLeafNode {
  return node.type === "leaf";
}

export function findNodeById(tree: LectureTree, nodeId: LectureNodeId): LectureNode | null {
  const stack: LectureNode[] = [tree.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === nodeId) return n;
    if (isFolder(n)) {
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }
  return null;
}

export function findFolderById(
  tree: LectureTree,
  folderId: LectureNodeId
): LectureFolderNode | null {
  const n = findNodeById(tree, folderId);
  return n && isFolder(n) ? n : null;
}

/**
 * leafId로 leaf 찾기 (회차 → leaf 매핑에 사용)
 */
export function findLeafById(tree: LectureTree, leafId: LectureLeafId): LectureLeafNode | null {
  const stack: LectureNode[] = [tree.root];
  while (stack.length) {
    const n = stack.pop()!;
    if (isLeaf(n) && n.leafId === leafId) return n;
    if (isFolder(n)) {
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }
  return null;
}

/**
 * 트리 전체를 펼쳐 leaf만 모읍니다 (B 방식용)
 * - default는 orderKey 오름차순 정렬 결과를 반환합니다.
 */
export function flattenLeaves(
  tree: LectureTree,
  opts?: { sortByOrderKey?: boolean }
): LectureLeafNode[] {
  const leaves: LectureLeafNode[] = [];
  const stack: LectureNode[] = [tree.root];

  while (stack.length) {
    const n = stack.pop()!;
    if (isLeaf(n)) {
      leaves.push(n);
      continue;
    }
    // folder: children을 역순 push → 원래 순서대로 DFS
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }

  if (opts?.sortByOrderKey !== false) {
    leaves.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  }
  return leaves;
}

// -------------------- orderKey (reindex / next) --------------------

/**
 * 현재 트리 구조(폴더/leaf 섞인 순서 포함)를 기준으로,
 * DFS로 leaf를 훑으며 orderKey를 000001부터 재부여합니다.
 *
 * ⚠️ leafId는 절대 건드리지 않습니다.
 */
export function reindexOrderKeys(tree: LectureTree): LectureTree {
  // 깊은 복사(간단 JSON clone)
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;

  const leavesInTraversal: LectureLeafNode[] = [];
  const stack: LectureNode[] = [cloned.root];

  while (stack.length) {
    const n = stack.pop()!;
    if (isLeaf(n)) {
      leavesInTraversal.push(n);
      continue;
    }
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
  }

  // 재부여
  for (let i = 0; i < leavesInTraversal.length; i++) {
    leavesInTraversal[i].orderKey = padOrder(i + 1);
  }

  cloned.updatedAt = nowIso();
  cloned.version = 1;
  return cloned;
}

/**
 * leaf를 새로 만들 때 부여할 orderKey(= 마지막 + 1)
 * - 새 leaf 생성 시 바로 값이 있어야 하므로 사용
 */
export function getNextOrderKeyForNewLeaf(tree: LectureTree): string {
  const leaves = flattenLeaves(tree, { sortByOrderKey: true });
  if (leaves.length === 0) return padOrder(1);
  const last = leaves[leaves.length - 1].orderKey;
  const n = Number(last);
  if (!Number.isFinite(n) || n <= 0) return padOrder(leaves.length + 1);
  return padOrder(n + 1);
}

/**
 * 다음 강의(leaf) 추천
 * - B 방식: 트리 전체 leaf를 orderKey로 정렬해서 다음을 찾음
 * - excludedLeafIds(중복 금지) 를 건너뜀
 */
export function getNextLeaf(
  tree: LectureTree,
  currentLeafId: LectureLeafId,
  excludedLeafIds: LectureLeafId[] = []
): LectureLeafNode | null {
  const leaves = flattenLeaves(tree, { sortByOrderKey: true });
  const excluded = new Set(excludedLeafIds);

  const idx = leaves.findIndex((l) => l.leafId === currentLeafId);
  if (idx < 0) return null;

  for (let i = idx + 1; i < leaves.length; i++) {
    if (excluded.has(leaves[i].leafId)) continue;
    return leaves[i];
  }
  return null;
}

// -------------------- edit helpers (create / update / reorder) --------------------

export function addFolder(tree: LectureTree, parentFolderId: LectureNodeId, title: string): LectureTree {
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;
  const parent = findFolderById(cloned, parentFolderId);
  if (!parent) return cloned;

  const folder: LectureFolderNode = {
    id: makeId(),
    type: "folder",
    title: title.trim() || "새 폴더",
    createdAt: nowIso(),
    children: [],
  };

  parent.children.push(folder);
  cloned.updatedAt = nowIso();
  return cloned;
}

export function addLeaf(
  tree: LectureTree,
  parentFolderId: LectureNodeId,
  payload: {
    title: string;
    lectureUrl: string;
    problemUrls?: string[];
  }
): LectureTree {
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;
  const parent = findFolderById(cloned, parentFolderId);
  if (!parent) return cloned;

  const leaf: LectureLeafNode = {
    id: makeId(),
    type: "leaf",
    title: payload.title.trim() || "새 강의",
    createdAt: nowIso(),
    leafId: makeId(), // ✅ 영구 ID
    orderKey: getNextOrderKeyForNewLeaf(cloned),
    lectureUrl: payload.lectureUrl?.trim() || "",
    problemUrls: (payload.problemUrls && payload.problemUrls.length > 0 ? payload.problemUrls : [""]).map(
      (s) => s ?? ""
    ),
  };

  parent.children.push(leaf);
  cloned.updatedAt = nowIso();
  return cloned;
}

export function updateNodeTitle(tree: LectureTree, nodeId: LectureNodeId, title: string): LectureTree {
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;
  const n = findNodeById(cloned, nodeId);
  if (!n) return cloned;
  n.title = title.trim() || n.title;
  cloned.updatedAt = nowIso();
  return cloned;
}

export function updateLeafLinks(
  tree: LectureTree,
  nodeId: LectureNodeId,
  links: { lectureUrl?: string; problemUrls?: string[] }
): LectureTree {
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;
  const n = findNodeById(cloned, nodeId);
  if (!n || !isLeaf(n)) return cloned;

  if (typeof links.lectureUrl === "string") n.lectureUrl = links.lectureUrl;
  if (Array.isArray(links.problemUrls)) n.problemUrls = links.problemUrls;
  cloned.updatedAt = nowIso();
  return cloned;
}

export function deleteNode(tree: LectureTree, nodeId: LectureNodeId): LectureTree {
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;

  function walk(folder: LectureFolderNode): boolean {
    const idx = folder.children.findIndex((c) => c.id === nodeId);
    if (idx >= 0) {
      folder.children.splice(idx, 1);
      return true;
    }
    for (const c of folder.children) {
      if (isFolder(c)) {
        const ok = walk(c);
        if (ok) return true;
      }
    }
    return false;
  }

  walk(cloned.root);
  cloned.updatedAt = nowIso();
  return cloned;
}

/**
 * 같은 부모 폴더의 children 순서를 교체합니다.
 * - folder/leaf 섞여 있어도 허용
 * - newChildIds는 "그 폴더의 children id들을 최종 순서대로" 넘겨야 합니다.
 */
export function reorderChildren(
  tree: LectureTree,
  parentFolderId: LectureNodeId,
  newChildIds: LectureNodeId[]
): LectureTree {
  const cloned = JSON.parse(JSON.stringify(tree)) as LectureTree;
  const parent = findFolderById(cloned, parentFolderId);
  if (!parent) return cloned;

  const map = new Map(parent.children.map((c) => [c.id, c]));
  const next: LectureNode[] = [];

  for (const id of newChildIds) {
    const n = map.get(id);
    if (n) next.push(n);
  }
  // 혹시 누락된 노드가 있다면 뒤에 붙임(데이터 유실 방지)
  for (const c of parent.children) {
    if (!newChildIds.includes(c.id)) next.push(c);
  }

  parent.children = next;
  cloned.updatedAt = nowIso();
  return cloned;
}

// -------------------- legacy session items (temporary) --------------------

export type SessionItem = {
  id: string;
  lectureId: string; // ✅ 당분간 유지(현재 UI 호환). 향후 leafId로 통일 권장.

  noteDone: boolean;
  solveDone: boolean;

  noteLink?: string;
  solveLink?: string;
};

/**
 * (레거시) 회차별 강의 아이템 로드
 * - 기존 화면이 의존하고 있을 수 있어 유지합니다.
 * - 동작:
 *   1) localStorage에 items가 있으면 그대로 반환
 *   2) 없으면 "강의 트리의 첫 3개 leaf"를 기본값으로 생성해 반환
 *
 * ⚠️ 추후: Session.lectureLeafIds 기반으로 완전히 대체 예정
 */
export function getSessionItemsDefault(token: string, sessionIndex: number): SessionItem[] {
  const key = legacyItemsKey(token, sessionIndex);
  const raw = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
  const parsed = safeParseJson<SessionItem[]>(raw);
  if (parsed && Array.isArray(parsed)) return parsed;

  const tree = loadLectureTree();
  const leaves = flattenLeaves(tree, { sortByOrderKey: true }).slice(0, 3);

  const base = leaves.map((leaf, i) => ({
    id: `${token}:${sessionIndex}:${i + 1}`,
    lectureId: leaf.leafId, // ✅ 일단 leafId를 넣어두면, 나중에 이관이 쉬움
    noteDone: false,
    solveDone: false,
    noteLink: "",
    solveLink: "",
  }));

  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, JSON.stringify(base));
  }
  return base;
}

// ✅ 과거 코드 호환용(이름 유지)
export const getSessionItemsMock = getSessionItemsDefault;

/**
 * (레거시 호환) 기존 코드용
 * - lectureId(=leafId)를 받아서, 내부에서 트리를 로드하고 leaf를 찾아 반환합니다.
 */
export function getLectureById(lectureId: string): LectureLeafNode | null {
  const tree = loadLectureTree();
  return findLeafById(tree, lectureId);
}
