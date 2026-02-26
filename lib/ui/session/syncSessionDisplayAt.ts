"use client";

import { buildBaseDatesISO, computeEffectiveISO, readMetaMap } from "@/lib/factories/sessionFactories";
import { loadSessions, saveSessions } from "@/lib/storage/sessions";
import { findStudentByToken } from "@/lib/storage/students";

export function syncSessionDisplayAtByToken(token: string): void {
  if (!token) return;

  const student = findStudentByToken(token);
  if (!student) return;

  const sessions = loadSessions();
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
  saveSessions(next);
}

