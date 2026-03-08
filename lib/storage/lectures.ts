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

function collectLegacyLeaves(node: unknown, out: unknown[]) {
  const rec = node && typeof node === "object" ? (node as Record<string, unknown>) : null;
  if (!rec) return;

  if (rec.type === "leaf") {
    out.push(rec);
    return;
  }

  if (rec.type !== "folder") return;
  const children = Array.isArray(rec.children) ? rec.children : [];
  for (const child of children) {
    collectLegacyLeaves(child, out);
  }
}

function buildTreeFromLeaves(leaves: unknown[], updatedAt?: string): LectureTree {
  const normalizedLeaves = leaves.map((leaf, idx) => normalizeLeaf(leaf, idx));
  return {
    version: 2,
    updatedAt: updatedAt && updatedAt.trim() ? updatedAt : nowIso(),
    root: {
      type: "folder",
      id: "lecture_root_v2",
      title: ROOT_TITLE,
      createdAt: nowIso(),
      children: normalizedLeaves,
    },
  };
}

function normalizeAnyTree(raw: unknown): LectureTree {
  if (!raw || typeof raw !== "object") return makeEmptyLectureTree();
  const rec = raw as Record<string, unknown>;

  if (Array.isArray(rec.lectures)) {
    return buildTreeFromLeaves(rec.lectures, typeof rec.updatedAt === "string" ? rec.updatedAt : undefined);
  }

  const root = rec.root;
  if (!root || typeof root !== "object") return makeEmptyLectureTree();

  const rootRec = root as Record<string, unknown>;
  if (rootRec.type !== "folder") return makeEmptyLectureTree();

  const legacyLeaves: unknown[] = [];
  collectLegacyLeaves(rootRec, legacyLeaves);
  return buildTreeFromLeaves(legacyLeaves, typeof rec.updatedAt === "string" ? rec.updatedAt : undefined);
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

  // 키가 아예 없을 때는 "읽기" 동작만 수행하고 저장하지 않음.
  // (저장 이벤트가 발생하면 SharedSnapshotAgent가 빈 트리를 DB로 올릴 수 있어 덮어쓰기 위험)
  if (!raw) {
    return normalized;
  }

  const parsed = safeParseJson<unknown>(raw);
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    persistTree(normalized);
  }

  return normalized;
}

export function saveLectureTree(tree: LectureTree): LectureTree {
  const leaves = flattenLeaves(tree, { sortByOrderKey: false });
  const normalized = buildTreeFromLeaves(leaves, nowIso());
  persistTree(normalized);
  return normalized;
}

export function saveLectureTreeWithReindex(tree: LectureTree): LectureTree {
  return saveLectureTree(tree);
}

export function findNodeById(tree: LectureTree, nodeId: LectureNodeId): LectureNode | null {
  if (tree.root.id === nodeId) return tree.root;
  for (const child of tree.root.children) {
    if (child.id === nodeId) return child;
  }
  return null;
}

export function findFolderById(tree: LectureTree, folderId: LectureNodeId): LectureFolderNode | null {
  if (tree.root.id === folderId) return tree.root;
  return null;
}

export function findLeafById(tree: LectureTree, leafId: LectureLeafId): LectureLeafNode | null {
  const leaves = flattenLeaves(tree, { sortByOrderKey: false });
  return leaves.find((leaf) => leaf.leafId === leafId) ?? null;
}

export function flattenLeaves(
  tree: LectureTree,
  opts?: { sortByOrderKey?: boolean }
): LectureLeafNode[] {
  const rootChildren = Array.isArray(tree.root.children) ? tree.root.children : [];
  const leaves = rootChildren.filter((child): child is LectureLeafNode => child.type === "leaf");
  if (opts?.sortByOrderKey === false) return [...leaves];
  return [...leaves].sort((a, b) => a.orderKey.localeCompare(b.orderKey));
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

export function saveLectureCatalog(leaves: LectureLeafNode[]): LectureLeafNode[] {
  const nextTree = saveLectureTree(buildTreeFromLeaves(leaves, nowIso()));
  return flattenLeaves(nextTree, { sortByOrderKey: true });
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
