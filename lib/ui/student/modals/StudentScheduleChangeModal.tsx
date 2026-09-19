import { useState } from "react";
import type { ScheduleRule, Student, Weekday } from "@/lib/types/index";
import { todayYmdKST } from "@/lib/utils/date";

export type ScheduleChangeRuleDraft = {
  weekday: Weekday;
  hour: number;
  minute?: number;
  durationHour: 1 | 1.5 | 2 | 2.5 | 3;
};

interface StudentScheduleChangeModalProps {
  isOpen: boolean;
  student: Student;
  initialStartDate?: string;
  initialStartIndex?: number;
  currentScheduleText: string;
  resolveScheduleStartIndexByDate?: (ymd: string) => number;
  onClose: () => void;
  onSave: (params: { startDate: string; startIndex: number; rules: ScheduleRule[] }) => Promise<boolean>;
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

function ScheduleChangeModalInner({
  student,
  initialStartDate,
  initialStartIndex = 1,
  currentScheduleText,
  resolveScheduleStartIndexByDate,
  onClose,
  onSave,
}: {
  student: Student;
  initialStartDate?: string;
  initialStartIndex?: number;
  currentScheduleText: string;
  resolveScheduleStartIndexByDate?: (ymd: string) => number;
  onClose: () => void;
  onSave: (params: { startDate: string; startIndex: number; rules: ScheduleRule[] }) => Promise<boolean>;
}) {
  const currentRules = resolveCurrentRules(student);
  const defaultWeekly = normalizeWeeklyCount(currentRules.length > 0 ? currentRules.length : 1);

  const [startDate, setStartDate] = useState(() => initialStartDate || todayYmdKST());
  const [startIndex, setStartIndex] = useState(() => (initialStartIndex > 0 ? initialStartIndex : 1));
  const [weeklyCount, setWeeklyCount] = useState(() => defaultWeekly);
  const [rules, setRules] = useState<ScheduleChangeRuleDraft[]>(() => {
    const source =
      currentRules.length > 0
        ? currentRules.map((r) => ({
            weekday: (Math.max(0, Math.min(6, Math.floor(Number(r.weekday) || 0))) as Weekday) ?? 1,
            hour: normalizeHour(Number(r.hour)),
            minute: Number(r.minute) >= 30 ? 30 : 0,
            durationHour: normalizeSessionAddDurationHour(Number(r.durationMin ?? 60) / 60),
          }))
        : [{ weekday: 1 as Weekday, hour: 17, minute: 0, durationHour: 1 as const }];

    const nextDrafts: ScheduleChangeRuleDraft[] = [];
    for (let i = 0; i < defaultWeekly; i++) {
      const picked = source[i % source.length];
      nextDrafts.push({
        weekday: picked.weekday,
        hour: normalizeHour(Number(picked.hour)),
        minute: Number(picked.minute) >= 30 ? 30 : 0,
        durationHour: normalizeSessionAddDurationHour(Number(picked.durationHour)),
      });
    }
    return nextDrafts;
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function updateWeeklyCount(nextRawCount: number) {
    const count = normalizeWeeklyCount(nextRawCount);
    setWeeklyCount(count);
    setRules((prev) => {
      const source = prev.length > 0 ? prev : [{ weekday: 1, hour: 17, minute: 0, durationHour: 1 }];
      const next: ScheduleChangeRuleDraft[] = [];
      for (let i = 0; i < count; i++) {
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

  function updateRule(index: number, patch: Partial<ScheduleChangeRuleDraft>) {
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
    const targetStartIndex = Math.max(1, Math.floor(Number(startIndex)));
    if (!Number.isFinite(targetStartIndex)) {
      setError("시작 회차를 올바르게 입력해주세요.");
      return;
    }
    const targetStartDate = startDate || todayYmdKST();
    const count = normalizeWeeklyCount(weeklyCount);
    const drafts = rules.slice(0, count);
    if (drafts.length === 0) {
      setError("수업 요일/시간을 최소 1개 선택해주세요.");
      return;
    }

    const convertedRules: ScheduleRule[] = drafts.map((rule) => ({
      weekday: rule.weekday,
      hour: rule.hour,
      minute: Number(rule.minute) >= 30 ? 30 : 0,
      durationMin: Math.round(normalizeSessionAddDurationHour(rule.durationHour) * 60),
    }));

    setSaving(true);
    const ok = await onSave({ startDate: targetStartDate, startIndex: targetStartIndex, rules: convertedRules });
    setSaving(false);
    if (!ok) {
      setError("시간표 변경 저장에 실패했습니다. 다시 시도해주세요.");
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
          maxWidth: 600,
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
          <div style={{ fontWeight: 900, fontSize: "1.1rem" }}>수업 시간 변경</div>
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
            <div style={{ fontWeight: 800 }}>시작 날짜</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const v = e.target.value;
                setStartDate(v);
                if (!v || !resolveScheduleStartIndexByDate) return;
                setStartIndex(resolveScheduleStartIndexByDate(v));
              }}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>시작 회차</div>
            <input
              type="number"
              min={1}
              value={startIndex}
              onChange={(e) => setStartIndex(Number(e.target.value))}
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
                key={`schedule-edit-rule-${i}`}
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
                      <option key={`schedule-edit-weekday-${d}`} value={d}>
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
                      aria-label={`${i + 1}번째 변경 시작 시`}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={`schedule-edit-hour-${h}`} value={h}>
                          {String(h).padStart(2, "0")}시
                        </option>
                      ))}
                    </select>
                    <select
                      value={rule.minute ?? 0}
                      onChange={(e) => updateRule(i, { minute: Number(e.target.value) as 0 | 30 })}
                      style={{ ...selectStyle, width: "100%" }}
                      aria-label={`${i + 1}번째 변경 시작 분`}
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
                    aria-label={`${i + 1}번째 변경 수업 시간`}
                  >
                    {([1, 1.5, 2, 2.5, 3] as const).map((duration) => (
                      <option key={`schedule-edit-duration-${duration}`} value={duration}>
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
            현재 적용중인 시간표 : {currentScheduleText}
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
              {saving ? "저장 중..." : "시간표 저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function StudentScheduleChangeModal(props: StudentScheduleChangeModalProps) {
  if (!props.isOpen) return null;
  return <ScheduleChangeModalInner key="schedule-change-open" {...props} />;
}
