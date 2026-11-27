import type { RoundBar } from "@/lib/factories/roundBar";

const ROUND_CELL_COLOR = { done: "var(--ok)", absent: "var(--alert)", todo: "var(--surface-border)" } as const;

/** 마지막 회차 묶음 막대 + 'n~m회차 · 남은 k회' (선생님 리스트·학생 메인 공용) */
export default function RoundBarView({ bar, size = 10 }: { bar: RoundBar; size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }} title={`${bar.start}~${bar.end}회차`}>
      {bar.cells.map((cell, i) => (
        <span key={i} style={{ width: size, height: size, borderRadius: 2, background: ROUND_CELL_COLOR[cell] }} />
      ))}
      <span style={{ fontSize: 12, color: "var(--text-subtle)", marginLeft: 6 }}>
        {bar.start}~{bar.end}회차 · 남은 {bar.remaining}회
      </span>
    </div>
  );
}
