"use client";

import { browserStorage } from "@/lib/storage/browserStorage";
import { safeParseJson } from "@/lib/storage/safeParse";
import { pullSharedSnapshotAndHydrateWithOptions, readLocalStudents, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import type { Session, Student, Teacher } from "@/lib/types/index";

type WithId = { id: string };

export type CoreSnapshotBaseline = {
  teachers: Teacher[];
  students: Student[];
  sessions: Session[];
};

export async function loadLatestCoreSnapshotBaseline(): Promise<CoreSnapshotBaseline> {
  const remote = await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
  if (remote) {
    return {
      teachers: remote.teachers,
      students: remote.students,
      sessions: remote.sessions,
    };
  }

  return {
    teachers: readLocalTeachers(),
    students: readLocalStudents(),
    sessions: safeParseJson<Session[]>(browserStorage.getItem("tutorweb_sessions_v1"), []),
  };
}

export async function loadLatestCoreSnapshotBaselineServerRequired(): Promise<CoreSnapshotBaseline> {
  const remote = await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
  if (!remote) {
    throw new Error("server_snapshot_unavailable");
  }
  return {
    teachers: remote.teachers,
    students: remote.students,
    sessions: remote.sessions,
  };
}

export function mergeById<T extends WithId>(base: T[], patch: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of base) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
  for (const row of patch) {
    if (!row?.id) continue;
    map.set(row.id, row);
  }
  return Array.from(map.values());
}
