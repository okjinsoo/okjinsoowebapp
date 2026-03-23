"use client";

import { buildBaseDatesISO, computeEffectiveISO, readMetaMap } from "@/lib/factories/sessionFactories";
import { findStudentByTokenInRows, readSnapshotServerFirst } from "@/lib/storage/serverRead";
import { saveSessionsServerFirst } from "@/lib/storage/sessions";

export async function syncSessionDisplayAtByToken(token: string): Promise<void> {
  if (!token) return;

  const snapshot = await readSnapshotServerFirst();
  const student = findStudentByTokenInRows(token, snapshot.students);
  if (!student) return;

  const sessions = snapshot.sessions;
  const own = sessions.filter((s) => s.studentId === student.id);
  if (own.length === 0) return;

  const maxIndex = own.reduce((m, s) => Math.max(m, s.index), 0);
  const baseDatesISO = buildBaseDatesISO(student, Math.max(120, student.planCount ?? 0, maxIndex));
  const metaMap = readMetaMap(token);

  let changed = false;
  const next = sessions.map((session) => {
    if (session.studentId !== student.id) return session;

    const { effectiveISO } = computeEffectiveISO({
      token,
      index: session.index,
      baseDatesISO,
      metaMap,
    });
    if (!effectiveISO || effectiveISO === session.displayAt) return session;
    changed = true;
    return {
      ...session,
      displayAt: effectiveISO,
    };
  });

  if (!changed) return;
  try {
    await saveSessionsServerFirst(next);
  } catch (err) {
    console.error("회차 날짜 동기화 서버 저장 실패:", err);
  }
}
