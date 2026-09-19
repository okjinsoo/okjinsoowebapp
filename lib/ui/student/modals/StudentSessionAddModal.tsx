import { useState } from "react";
import type { ScheduleRule, Student, Weekday } from "@/lib/types/index";
import { todayYmdKST } from "@/lib/utils/date";

export type SessionAddRuleDraft = {
  weekday: Weekday;
  hour: number;
  minute?: number;
  durationHour: 1 | 1.5 | 2 | 2.5 | 3;
};

interface StudentSessionAddModalProps {
  isOpen: boolean;
  student: Student;
  onClose: () => void;
  onSave: (params: { startDate: string; addedCount: number; rules: ScheduleRule[] }) => Promise<boolean>;
}

const inputStyle = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--surface-border)",
  borderRadius: 8,
  background: "var(--background)",
  color: "var(--foreground)",
  fontFamily: "inherit",
};

const selectStyle = {
  border: "1px solid var(--control-border)",
  background: "var(--surface-bg)",
  color: "var(--foreground)",
  borderRadius: 8,
  padding: 8,
  width: "100%",
  minWidth: 60,
};

const boxButton = {
  padding: "8px 12px",
  border: "1px solid var(--surface-border)",
  borderRadius: 8,
  background: "var(--surface-bg)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontWeight: 600,
};

function normalizeHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function normalizeWeeklyCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(7, Math.floor(n)));
}

function normalizeSessionAddCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
}

function normalizeSessionAddDurationHour(v: number): 1 | 1.5 | 2 | 2.5 | 3 {
  if (!Number.isFinite(v)) return 1;
  if (v <= 1.25) return 1;
  if (v <= 1.75) return 1.5;
  if (v <= 2.25) return 2;
  if (v <= 2.75) return 2.5;
  return 3;
}

function formatDurationHourLabel(durationHour: number): string {
  if (durationHour === 1.5) return "1시간 30분";
  if (durationHour === 2.5) return "2시간 30분";
  return `${durationHour}시간`;
}

function formatTimeLabel(hour: number, minute: number = 0): string {
  const hh = String(normalizeHour(hour)).padStart(2, "0");
  const mm = Number(minute) >= 30 ? "30" : "00";
  return `${hh}시 ${mm}분`;
}

function weekdayFullLabel(n: number): string {
  const map: Record<number, string> = {
    0: "일요일",
    1: "월요일",
    2: "화요일",
    3: "수요일",
    4: "목요일",
    5: "금요일",
    6: "토요일",
  };
  return map[n] ?? `${n}요일`;
}

function resolveCurrentRules(student: Student): ScheduleRule[] {
  const events = [...(student.scheduleChangeEvents ?? [])].sort((a, b) => a.startIndex - b.startIndex);
  const latestEvent = events.at(-1);
  if (latestEvent && Array.isArray(latestEvent.newRules) && latestEvent.newRules.length > 0) {
    return latestEvent.newRules;
  }
  return Array.isArray(student.scheduleRules) ? student.scheduleRules : [];
}

function buildSessionAddRulesByCount(count: number, sourceRules: ScheduleRule[]): SessionAddRuleDraft[] {
  const source =
    sourceRules.length > 0
      ? sourceRules.map((r) => ({
          weekday: (Math.max(0, Math.min(6, Math.floor(Number(r.weekday) || 0))) as Weekday) ?? 1,
          hour: normalizeHour(Number(r.hour)),
          minute: Number(r.minute) >= 30 ? 30 : 0,
          durationHour: normalizeSessionAddDurationHour(Number(r.durationMin ?? 60) / 60),
        }))
      : [{ weekday: 1 as Weekday, hour: 17, minute: 0, durationHour: 1 as const }];

  const nextCount = normalizeWeeklyCount(count);
  const next: SessionAddRuleDraft[] = [];
  for (let i = 0; i < nextCount; i++) {
    const picked = source[i % source.length];
    next.push({
      weekday: picked.weekday,
      hour: normalizeHour(Number(picked.hour)),
      minute: Number(picked.minute) >= 30 ? 30 : 0,
      durationHour: normalizeSessionAddDurationHour(Number(picked.durationHour)),
    });
  }
  return next;
}

function SessionAddModalInner({
  student,
  onClose,
  onSave,
}: {
  student: Student;
  onClose: () => void;
  onSave: (params: { startDate: string; addedCount: number; rules: ScheduleRule[] }) => Promise<boolean>;
}) {
  const currentRules = resolveCurrentRules(student);
  const defaultWeekly = normalizeWeeklyCount(currentRules.length > 0 ? currentRules.length : 1);

  const [startDate, setStartDate] = useState(() => todayYmdKST());
  const [weeklyCount, setWeeklyCount] = useState(() => defaultWeekly);
  const [addedCount, setAddedCount] = useState(() => Math.max(1, defaultWeekly * 4));
  const [rules, setRules] = useState<SessionAddRuleDraft[]>(() =>
    buildSessionAddRulesByCount(defaultWeekly, currentRules)
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateWeeklyCount(nextRawCount: number) {
    const nextCount = normalizeWeeklyCount(nextRawCount);
    setWeeklyCount(nextCount);
    setRules((prev) => {
      const source = prev.length > 0 ? prev : [{ weekday: 1, hour: 17, minute: 0, durationHour: 1 }];
      const next: SessionAddRuleDraft[] = [];
      for (let i = 0; i < nextCount; i++) {
        const picked = prev[i] ?? source[i % source.length];
        next.push({
          weekday: Math.max(0, Math.min(6, Math.floor(Number(picked.weekday) || 0))) as Weekday,
          hour: normalizeHour(Number(picked.hour)),
          minute: Number(picked.minute) >= 30 ? 30 : 0,
          durationHour: normalizeSessionAddDurationHour(Number(picked.durationHour)),
        });
      }
      return next;
    });
  }

  function updateRule(index: number, patch: Partial<SessionAddRuleDraft>) {
    setRules((prev) =>
      prev.map((rule, i) => {
        if (i !== index) return rule;
        return {
          weekday:
            patch.weekday === undefined
              ? rule.weekday
              : (Math.max(0, Math.min(6, Math.floor(Number(patch.weekday)))) as Weekday),
          hour: patch.hour === undefined ? rule.hour : normalizeHour(Number(patch.hour)),
          minute: patch.minute === undefined ? (rule.minute ?? 0) : Number(patch.minute) >= 30 ? 30 : 0,
          durationHour:
            patch.durationHour === undefined
              ? rule.durationHour
              : normalizeSessionAddDurationHour(Number(patch.durationHour)),
        };
      })
    );
  }

  async function handleSave() {
    setError("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError("시작일을 올바르게 입력해주세요 (YYYY-MM-DD).");
      return;
    }
    const count = normalizeSessionAddCount(addedCount);
    const activeRules = rules.slice(0, normalizeWeeklyCount(weeklyCount));
    if (activeRules.length === 0) {
      setError("최소 1개 이상의 요일 규칙이 필요합니다.");
      return;
    }

    const convertedRules: ScheduleRule[] = activeRules.map((r) => ({
      weekday: r.weekday,
      hour: r.hour,
      minute: r.minute ?? 0,
      durationMin: Math.round(r.durationHour * 60),
    }));

    setSaving(true);
    const ok = await onSave({ startDate, addedCount: count, rules: convertedRules });
    setSaving(false);
    if (!ok) {
      setError("회차 추가 저장에 실패했습니다. 다시 시도해주세요.");
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 75,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--surface-bg)",
          border: "1px solid var(--surface-border)",
          color: "var(--foreground)",
          borderRadius: 14,
          padding: 16,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>회차 추가</div>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: "1.2rem",
              color: "var(--text-muted)",
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>시작일</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>추가 회차수</div>
            <input
              type="number"
              min={1}
              value={addedCount}
              onChange={(e) => setAddedCount(Number(e.target.value))}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>주당 횟수</div>
            <input
              type="number"
              min={1}
              max={7}
              value={weeklyCount}
              onChange={(e) => updateWeeklyCount(Number(e.target.value))}
              style={inputStyle}
            />
          </div>

          <div
            style={{
              display: "grid",
              gridAutoFlow: "column",
              gridAutoColumns: "minmax(240px, 1fr)",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
            }}
          >
            {rules.slice(0, normalizeWeeklyCount(weeklyCount)).map((rule, i) => (
              <div
                key={`session-add-rule-${i}`}
                style={{
                  border: "1px solid var(--surface-border)",
                  borderRadius: 10,
                  background: "var(--background)",
                  padding: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>{i + 1}번째 수업</div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>요일</span>
                  <select
                    value={rule.weekday}
                    onChange={(e) => updateRule(i, { weekday: Number(e.target.value) as Weekday })}
                    style={{ ...selectStyle, width: "100%" }}
                  >
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={`weekday-${d}`} value={d}>
                        {weekdayFullLabel(d)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>시작 시간</span>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <select
                      value={rule.hour}
                      onChange={(e) => updateRule(i, { hour: Number(e.target.value) })}
                      style={{ ...selectStyle, width: "100%" }}
                      aria-label={`${i + 1}번째 수업 시작 시`}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={`hour-${h}`} value={h}>
                          {String(h).padStart(2, "0")}시
                        </option>
                      ))}
                    </select>
                    <select
                      value={rule.minute ?? 0}
                      onChange={(e) => updateRule(i, { minute: Number(e.target.value) as 0 | 30 })}
                      style={{ ...selectStyle, width: "100%" }}
                      aria-label={`${i + 1}번째 수업 시작 분`}
                    >
                      <option value={0}>00분</option>
                      <option value={30}>30분</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>수업시간</span>
                  <select
                    value={rule.durationHour}
                    onChange={(e) =>
                      updateRule(i, { durationHour: Number(e.target.value) as 1 | 1.5 | 2 | 2.5 | 3 })
                    }
                    style={{ ...selectStyle, width: "100%" }}
                    aria-label={`${i + 1}번째 수업 시간`}
                  >
                    {([1, 1.5, 2, 2.5, 3] as const).map((duration) => (
                      <option key={`duration-${duration}`} value={duration}>
                        {formatDurationHourLabel(duration)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  {weekdayFullLabel(rule.weekday)} · {formatTimeLabel(rule.hour, rule.minute ?? 0)} 시작 ·{" "}
                  {formatDurationHourLabel(normalizeSessionAddDurationHour(rule.durationHour))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
            총 {normalizeSessionAddCount(addedCount)}회차가 추가됩니다.
          </div>

          {error ? <div style={{ color: "#dc2626", fontSize: "0.9rem" }}>{error}</div> : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
            <button
              onClick={onClose}
              style={{ ...boxButton, padding: "8px 14px" }}
              disabled={saving}
            >
              취소
            </button>
            <button
              onClick={handleSave}
              style={{
                ...boxButton,
                padding: "8px 16px",
                background: "var(--primary-color, #2563eb)",
                color: "#ffffff",
                border: "none",
                fontWeight: 700,
              }}
              disabled={saving}
            >
              {saving ? "적용 중..." : "회차 추가 적용"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentSessionAddModal(props: StudentSessionAddModalProps) {
  if (!props.isOpen) return null;
  return <SessionAddModalInner key="session-add-open" {...props} />;
}
