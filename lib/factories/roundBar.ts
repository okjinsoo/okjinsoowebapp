import { buildDisplayRecords } from "@/lib/factories/lessonStatusFactory";
import type { SessionMeta, Student } from "@/lib/types/index";

export type RoundCell = "done" | "absent" | "todo";
export type RoundBar = { start: number; end: number; cells: RoundCell[]; remaining: number };

/**
 * 학생의 '마지막 회차 묶음'(가장 최근 회차 추가 기록) 진행 막대.
 * 지난 회차는 done(결석이면 absent), 아직 안 한 회차는 todo.
 */
export function buildRoundBar(args: {
  student: Student;
  sessions: Array<{ index: number; effectiveISO: string | null; meta: SessionMeta }>;
  nowMs: number;
}): RoundBar | null {
  const { displayRecords } = buildDisplayRecords(args.student, args.student.paymentHistory ?? []);
  const last = displayRecords[displayRecords.length - 1];
  const start = Math.floor(Number(last?.startIndex) || 0);
  const end = Math.floor(Number(last?.endIndex) || 0);
  if (start < 1 || end < start) return null;

  const byIndex = new Map(args.sessions.map((s) => [s.index, s]));
  const cells: RoundCell[] = [];
  for (let i = start; i <= end; i += 1) {
    const s = byIndex.get(i);
    const startMs = s?.effectiveISO ? Date.parse(s.effectiveISO) : NaN;
    if (s?.meta.status === "absent") cells.push("absent");
    else if (Number.isFinite(startMs) && startMs < args.nowMs) cells.push("done");
    else cells.push("todo");
  }
  return { start, end, cells, remaining: cells.filter((c) => c === "todo").length };
}
