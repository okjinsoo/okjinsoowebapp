"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { SHARED_LECTURE_TREE_KEY } from "@/lib/storage/sharedStateKeys";
import type {
  LectureTree,
  LectureNode,
  LectureFolderNode,
  LectureLeafNode,
  LectureLeafId,
  LectureNodeId,
} from "@/lib/types/index";

const KEY_LECTURE_TREE = SHARED_LECTURE_TREE_KEY;
const ROOT_TITLE = "강의 저장소";
const DEFAULT_FOLDER_TITLE = "기본 폴더";

function nowIso() {
  return new Date().toISOString();
}

function makeId(): string {
  if (typeof crypto !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
    if (typeof crypto.getRandomValues === "function") {
      const buf = new Uint32Array(4);
      crypto.getRandomValues(buf);
      return Array.from(buf, (x) => x.toString(16).padStart(8, "0")).join("");
    }
  }
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

export function isFolder(node: LectureNode): node is LectureFolderNode {
  return node.type === "folder";
}

export function isLeaf(node: LectureNode): node is LectureLeafNode {
  return node.type === "leaf";
}

function normalizeProblemUrls(problemUrls: unknown): string[] {
  if (!Array.isArray(problemUrls)) return [""];
  const first = problemUrls.find((v) => typeof v === "string") as string | undefined;
  return [first ?? ""];
}

function normalizeLeaf(raw: unknown, index: number): LectureLeafNode {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const leafId = typeof rec.leafId === "string" && rec.leafId.trim() ? rec.leafId.trim() : makeId();
  const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `leaf_${leafId}`;
  const title = typeof rec.title === "string" ? rec.title : "제목 없는 강의";
  const lectureUrl = typeof rec.lectureUrl === "string" ? rec.lectureUrl : "";
  const createdAt = typeof rec.createdAt === "string" && rec.createdAt.trim() ? rec.createdAt.trim() : nowIso();

  return {
    type: "leaf",
    id,
    title,
    createdAt,
    leafId,
    orderKey: padOrder(index + 1),
    lectureUrl,
    problemUrls: normalizeProblemUrls(rec.problemUrls),
  };
}

// ===== 공개 타입 =====
export type LeafWithContext = {
  leaf: LectureLeafNode;
  folderTitle: string | null;
  folderId: string | null;
};

// ===== 폴더 관리 함수 =====

/** root의 직접 자식 중 folder 타입만 반환 */
export function getFoldersFromTree(tree: LectureTree): LectureFolderNode[] {
  return tree.root.children.filter(isFolder);
}

/** 폴더 추가 */
export function addFolderToTree(tree: LectureTree, title: string): LectureTree {
  const folderCount = tree.root.children.filter(isFolder).length;
  const newFolder: LectureFolderNode = {
    type: "folder",
    id: `folder_${makeId()}`,
    title: title.trim() || "새 폴더",
    createdAt: nowIso(),
    orderKey: padOrder(folderCount + 1),
    children: [],
  };
  return {
    ...tree,
    updatedAt: nowIso(),
    root: { ...tree.root, children: [...tree.root.children, newFolder] },
  };
}

/** 폴더 삭제 */
export function removeFolderFromTree(tree: LectureTree, folderId: LectureNodeId): LectureTree {
  return {
    ...tree,
    updatedAt: nowIso(),
    root: { ...tree.root, children: tree.root.children.filter((c) => c.id !== folderId) },
  };
}

/** 폴더 이름 변경 */
export function renameFolderInTree(tree: LectureTree, folderId: LectureNodeId, newTitle: string): LectureTree {
  return {
    ...tree,
    updatedAt: nowIso(),
    root: {
      ...tree.root,
      children: tree.root.children.map((c) =>
        c.id === folderId && isFolder(c) ? { ...c, title: newTitle } : c
      ),
    },
  };
}

/** 폴더 순서 이동 */
export function moveFolderInTree(tree: LectureTree, folderId: LectureNodeId, offset: -1 | 1): LectureTree {
  const children = [...tree.root.children];
  const idx = children.findIndex((c) => c.id === folderId);
  if (idx < 0) return tree;
  const nextIdx = idx + offset;
  if (nextIdx < 0 || nextIdx >= children.length) return tree;
  const tmp = children[idx];
  children[idx] = children[nextIdx];
  children[nextIdx] = tmp;
  return { ...tree, updatedAt: nowIso(), root: { ...tree.root, children } };
}

/** 폴더에 강의 추가 */
export function addLeafToFolder(tree: LectureTree, folderId: LectureNodeId, leaf: LectureLeafNode): LectureTree {
  return {
    ...tree,
    updatedAt: nowIso(),
    root: {
      ...tree.root,
      children: tree.root.children.map((c) => {
        if (c.id !== folderId || !isFolder(c)) return c;
        const newLeaf = { ...leaf, orderKey: padOrder(c.children.length + 1) };
        return { ...c, children: [...c.children, newLeaf] };
      }),
    },
  };
}

/** 폴더에서 강의 삭제 */
export function removeLeafFromFolder(tree: LectureTree, folderId: LectureNodeId, leafId: LectureLeafId): LectureTree {
  return {
    ...tree,
    updatedAt: nowIso(),
    root: {
      ...tree.root,
      children: tree.root.children.map((c) => {
        if (c.id !== folderId || !isFolder(c)) return c;
        return { ...c, children: c.children.filter((l) => !isLeaf(l) || l.leafId !== leafId) };
      }),
    },
  };
}

/** 강의 정보 수정 (어느 폴더에 있든 leafId로 탐색) */
export function patchLeafInTree(
  tree: LectureTree,
  leafId: LectureLeafId,
  patch: Partial<Pick<LectureLeafNode, "title" | "lectureUrl" | "problemUrls">>
): LectureTree {
  return {
    ...tree,
    updatedAt: nowIso(),
    root: {
      ...tree.root,
      children: tree.root.children.map((c) => {
        if (!isFolder(c)) return c;
        return {
          ...c,
          children: c.children.map((l) => {
            if (!isLeaf(l) || l.leafId !== leafId) return l;
            return { ...l, ...patch };
          }),
        };
      }),
    },
  };
}

/** 폴더 안에서 강의 순서 이동 */
export function moveLeafInFolder(
  tree: LectureTree,
  folderId: LectureNodeId,
  leafId: LectureLeafId,
  offset: -1 | 1
): LectureTree {
  return {
    ...tree,
    updatedAt: nowIso(),
    root: {
      ...tree.root,
      children: tree.root.children.map((c) => {
        if (c.id !== folderId || !isFolder(c)) return c;
        const leaves = [...c.children];
        const idx = leaves.findIndex((l) => isLeaf(l) && l.leafId === leafId);
        if (idx < 0) return c;
        const nextIdx = idx + offset;
        if (nextIdx < 0 || nextIdx >= leaves.length) return c;
        const tmp = leaves[idx];
        leaves[idx] = leaves[nextIdx];
        leaves[nextIdx] = tmp;
        return { ...c, children: leaves };
      }),
    },
  };
}

/**
 * 고유코드(leafId)로 강의 불러오기
 * - 원본 leafId로 강의를 찾아 URL을 복사하여 현재 폴더에 새 강의로 추가
 * - 새 leafId를 발급하여 완전히 독립적인 강의로 생성
 */
export function importLeafByCode(
  tree: LectureTree,
  folderId: LectureNodeId,
  sourceLeafId: LectureLeafId
): { tree: LectureTree; newLeaf: LectureLeafNode } | null {
  const source = findLeafById(tree, sourceLeafId);
  if (!source) return null;

  const newLeafId = makeId();
  const newLeaf: LectureLeafNode = {
    type: "leaf",
    id: `leaf_${newLeafId}`,
    title: source.title,
    createdAt: nowIso(),
    leafId: newLeafId,
    orderKey: "",
    lectureUrl: source.lectureUrl,
    problemUrls: [...source.problemUrls],
  };
  return { tree: addLeafToFolder(tree, folderId, newLeaf), newLeaf };
}

// ===== 트리 정규화 (마이그레이션 포함) =====

function wrapLeavesInDefaultFolder(leaves: LectureLeafNode[], updatedAt?: string): LectureTree {
  const defaultFolder: LectureFolderNode = {
    type: "folder",
    id: "folder_default",
    title: DEFAULT_FOLDER_TITLE,
    createdAt: nowIso(),
    orderKey: padOrder(1),
    children: leaves,
  };
  return {
    version: 2,
    updatedAt: updatedAt ?? nowIso(),
    root: {
      type: "folder",
      id: "lecture_root_v2",
      title: ROOT_TITLE,
      createdAt: nowIso(),
      children: leaves.length > 0 ? [defaultFolder] : [],
    },
  };
}

function collectAllLeaves(node: unknown, out: unknown[]) {
  const rec = node && typeof node === "object" ? (node as Record<string, unknown>) : null;
  if (!rec) return;
  if (rec.type === "leaf") { out.push(rec); return; }
  if (rec.type !== "folder") return;
  const children = Array.isArray(rec.children) ? rec.children : [];
  for (const child of children) collectAllLeaves(child, out);
}

function normalizeAnyTree(raw: unknown): LectureTree {
  if (!raw || typeof raw !== "object") return makeEmptyLectureTree();
  const rec = raw as Record<string, unknown>;
  const updatedAt = typeof rec.updatedAt === "string" ? rec.updatedAt : undefined;

  // Legacy: flat lectures array (가장 오래된 형식)
  if (Array.isArray(rec.lectures)) {
    const leaves = rec.lectures.map((l, i) => normalizeLeaf(l, i));
    return wrapLeavesInDefaultFolder(leaves, updatedAt);
  }

  const root = rec.root;
  if (!root || typeof root !== "object") return makeEmptyLectureTree();
  const rootRec = root as Record<string, unknown>;
  if (rootRec.type !== "folder") return makeEmptyLectureTree();

  const rootChildren = Array.isArray(rootRec.children) ? rootRec.children : [];

  // 새 포맷: root 자식에 sub-folder가 있으면 그대로 정규화
  const hasSubFolders = rootChildren.some((c: unknown) => {
    const cr = c as Record<string, unknown> | null;
    return cr?.type === "folder";
  });

  if (hasSubFolders) {
    const normalizedChildren: LectureNode[] = rootChildren.map((c: unknown, folderIdx: number) => {
      const cr = c as Record<string, unknown>;
      if (cr?.type === "leaf") return normalizeLeaf(c, folderIdx);
      if (cr?.type === "folder") {
        const folderChildren = Array.isArray(cr.children) ? cr.children : [];
        return {
          type: "folder",
          id: typeof cr.id === "string" ? cr.id : `folder_${makeId()}`,
          title: typeof cr.title === "string" ? cr.title : "폴더",
          createdAt: typeof cr.createdAt === "string" ? cr.createdAt : nowIso(),
          orderKey: typeof cr.orderKey === "string" ? cr.orderKey : padOrder(folderIdx + 1),
          children: folderChildren.map((l: unknown, i: number) => normalizeLeaf(l, i)),
        } as LectureFolderNode;
      }
      return normalizeLeaf(c, folderIdx);
    });
    return {
      version: 2,
      updatedAt: updatedAt ?? nowIso(),
      root: {
        type: "folder",
        id: typeof rootRec.id === "string" ? rootRec.id : "lecture_root_v2",
        title: ROOT_TITLE,
        createdAt: nowIso(),
        children: normalizedChildren,
      },
    };
  }

  // 기존 flat 형식: root 바로 아래에 leaf만 있음 → "기본 폴더"로 감싸서 마이그레이션
  const legacyLeaves: unknown[] = [];
  collectAllLeaves(rootRec, legacyLeaves);
  const normalized = legacyLeaves.map((l, i) => normalizeLeaf(l, i));
  return wrapLeavesInDefaultFolder(normalized, updatedAt);
}

export function parseLectureTreeRaw(raw: string | null): LectureTree {
  const parsed = safeParseJson<unknown>(raw);
  return normalizeAnyTree(parsed);
}

function persistTree(tree: LectureTree): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(tree);
  const prev = browserStorage.getItem(KEY_LECTURE_TREE);
  if (prev === raw) return;
  browserStorage.setItem(KEY_LECTURE_TREE, raw);
  window.dispatchEvent(new CustomEvent(TUTORWEB_EVENTS.lectureTreeUpdated));
}

export function makeEmptyLectureTree(): LectureTree {
  return {
    version: 2,
    updatedAt: nowIso(),
    root: {
      type: "folder",
      id: "lecture_root_v2",
      title: ROOT_TITLE,
      createdAt: nowIso(),
      children: [],
    },
  };
}

export function loadLectureTree(): LectureTree {
  const raw = typeof window !== "undefined" ? browserStorage.getItem(KEY_LECTURE_TREE) : null;
  const normalized = parseLectureTreeRaw(raw);

  if (!raw) return normalized;

  const parsed = safeParseJson<unknown>(raw);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    persistTree(normalized);
  }
  return normalized;
}

/** 폴더 구조를 그대로 저장 (기존 flatten 방식 제거) */
export function saveLectureTree(tree: LectureTree): LectureTree {
  const withTimestamp = { ...tree, updatedAt: nowIso() };
  persistTree(withTimestamp);
  return withTimestamp;
}

export function saveLectureTreeWithReindex(tree: LectureTree): LectureTree {
  return saveLectureTree(tree);
}

export function findNodeById(tree: LectureTree, nodeId: LectureNodeId): LectureNode | null {
  if (tree.root.id === nodeId) return tree.root;
  for (const child of tree.root.children) {
    if (child.id === nodeId) return child;
    if (isFolder(child)) {
      for (const grandchild of child.children) {
        if (grandchild.id === nodeId) return grandchild;
      }
    }
  }
  return null;
}

export function findFolderById(tree: LectureTree, folderId: LectureNodeId): LectureFolderNode | null {
  if (tree.root.id === folderId) return tree.root;
  for (const child of tree.root.children) {
    if (isFolder(child) && child.id === folderId) return child;
  }
  return null;
}

export function findLeafById(tree: LectureTree, leafId: LectureLeafId): LectureLeafNode | null {
  for (const child of tree.root.children) {
    if (isLeaf(child) && child.leafId === leafId) return child;
    if (isFolder(child)) {
      for (const grandchild of child.children) {
        if (isLeaf(grandchild) && grandchild.leafId === leafId) return grandchild;
      }
    }
  }
  return null;
}

/** 모든 폴더의 leaf를 순서대로 수집 (재귀) */
export function flattenLeaves(
  tree: LectureTree,
  opts?: { sortByOrderKey?: boolean }
): LectureLeafNode[] {
  const out: LectureLeafNode[] = [];
  for (const child of tree.root.children) {
    if (isLeaf(child)) {
      out.push(child);
    } else if (isFolder(child)) {
      for (const grandchild of child.children) {
        if (isLeaf(grandchild)) out.push(grandchild);
      }
    }
  }
  if (opts?.sortByOrderKey === false) return out;
  return [...out].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
}

/** 폴더 컨텍스트 포함 leaf 목록 반환 (피커 등에서 사용) */
export function flattenLeavesWithContext(tree: LectureTree): LeafWithContext[] {
  const out: LeafWithContext[] = [];
  for (const child of tree.root.children) {
    if (isLeaf(child)) {
      out.push({ leaf: child, folderTitle: null, folderId: null });
    } else if (isFolder(child)) {
      for (const grandchild of child.children) {
        if (isLeaf(grandchild)) {
          out.push({ leaf: grandchild, folderTitle: child.title, folderId: child.id });
        }
      }
    }
  }
  return out;
}

export function getNextLeaf(
  tree: LectureTree,
  currentLeafId: LectureLeafId,
  excludedLeafIds: LectureLeafId[] = []
): LectureLeafNode | null {
  const leaves = flattenLeaves(tree, { sortByOrderKey: true });
  const excluded = new Set(excludedLeafIds);
  const idx = leaves.findIndex((leaf) => leaf.leafId === currentLeafId);
  if (idx < 0) return null;

  for (let i = idx + 1; i < leaves.length; i += 1) {
    if (excluded.has(leaves[i].leafId)) continue;
    return leaves[i];
  }
  return null;
}

export function loadLectureCatalog(): LectureLeafNode[] {
  return flattenLeaves(loadLectureTree(), { sortByOrderKey: true });
}

// Legacy compat: saveLectureCatalog (flat list → default folder 래핑)
export function saveLectureCatalog(leaves: LectureLeafNode[]): LectureLeafNode[] {
  const tree = wrapLeavesInDefaultFolder(leaves, nowIso());
  const saved = saveLectureTree(tree);
  return flattenLeaves(saved, { sortByOrderKey: true });
}

export function createLectureLeaf(input?: {
  title?: string;
  lectureUrl?: string;
  problemUrl?: string;
}): LectureLeafNode {
  const leafId = makeId();
  return {
    type: "leaf",
    id: `leaf_${leafId}`,
    title: (input?.title ?? "").trim() || "새 강의",
    createdAt: nowIso(),
    leafId,
    orderKey: "",
    lectureUrl: (input?.lectureUrl ?? "").trim(),
    problemUrls: [(input?.problemUrl ?? "").trim()],
  };
}

export type SessionItem = {
  id: string;
  lectureId: string;
  noteDone: boolean;
  solveDone: boolean;
  noteLink?: string;
  solveLink?: string;
};

function legacyItemsKey(token: string, sessionIndex: number) {
  return `mk3:${token}:session:${sessionIndex}:items`;
}

export function getSessionItemsDefault(token: string, sessionIndex: number): SessionItem[] {
  const key = legacyItemsKey(token, sessionIndex);
  const raw = typeof window !== "undefined" ? browserStorage.getItem(key) : null;
  const parsed = safeParseJson<SessionItem[]>(raw);
  if (parsed && Array.isArray(parsed)) return parsed;

  const leaves = loadLectureCatalog().slice(0, 3);
  const base = leaves.map((leaf, i) => ({
    id: `${token}:${sessionIndex}:${i + 1}`,
    lectureId: leaf.leafId,
    noteDone: false,
    solveDone: false,
    noteLink: "",
    solveLink: "",
  }));

  if (typeof window !== "undefined") {
    browserStorage.setItem(key, JSON.stringify(base));
  }
  return base;
}

export const getSessionItemsMock = getSessionItemsDefault;

export function getLectureById(lectureId: string): LectureLeafNode | null {
  return findLeafById(loadLectureTree(), lectureId);
}
