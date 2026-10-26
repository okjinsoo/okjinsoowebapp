import { useState } from "react";
import type { ScheduleRule, Student } from "@/lib/types/index";
import { todayYmdKST } from "@/lib/utils/date";

export interface StudentSessionAddModalProps {
  isOpen: boolean;
  student: Student;
  onClose: () => void;
  onSave: (params: { startDate: string; addedCount: number }) => Promise<boolean>;
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

const boxButton = {
  padding: "8px 12px",
  border: "1px solid var(--surface-border)",
  borderRadius: 8,
  background: "var(--surface-bg)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontWeight: 600,
};

function normalizeSessionAddCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.floor(n));
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

function formatRuleSummary(rules: ScheduleRule[]): string {
  if (!rules || rules.length === 0) return "설정된 시간표 없음";
  return rules
    .map((r) => {
      const hh = String(r.hour).padStart(2, "0");
      const mm = Number(r.minute) >= 30 ? "30" : "00";
      return `${weekdayFullLabel(r.weekday)} ${hh}:${mm}`;
    })
    .join(", ");
}

function resolveCurrentRules(student: Student): ScheduleRule[] {
  const events = [...(student.scheduleChangeEvents ?? [])].sort((a, b) => a.startIndex - b.startIndex);
  const latestEvent = events.at(-1);
  if (latestEvent && Array.isArray(latestEvent.newRules) && latestEvent.newRules.length > 0) {
    return latestEvent.newRules;
  }
  return Array.isArray(student.scheduleRules) ? student.scheduleRules : [];
}

function SessionAddModalInner({
  student,
  onClose,
  onSave,
}: {
  student: Student;
  onClose: () => void;
  onSave: (params: { startDate: string; addedCount: number }) => Promise<boolean>;
}) {
  const currentRules = resolveCurrentRules(student);
  const defaultWeekly = Math.max(1, currentRules.length || 1);

  const [startDate, setStartDate] = useState(() => todayYmdKST());
  const [addedCount, setAddedCount] = useState(() => Math.max(1, defaultWeekly * 4));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setError("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError("시작일을 올바르게 입력해주세요 (YYYY-MM-DD).");
      return;
    }
    const count = normalizeSessionAddCount(addedCount);
    if (count < 1) {
      setError("추가할 회차 수를 1 이상 입력해주세요.");
      return;
    }

    setSaving(true);
    const ok = await onSave({ startDate, addedCount: count });
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
          maxWidth: 480,
          background: "var(--surface-bg)",
          border: "1px solid var(--surface-border)",
          color: "var(--foreground)",
          borderRadius: 14,
          padding: 20,
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 900, fontSize: "1.15rem" }}>회차 추가</div>
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

        <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>시작일</div>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 800 }}>추가 회차수</div>
            <input
              type="number"
              min={1}
              value={addedCount}
              onChange={(e) => setAddedCount(Number(e.target.value))}
              style={inputStyle}
            />
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 8,
              background: "var(--background)",
              border: "1px solid var(--surface-border)",
              fontSize: "0.88rem",
              lineHeight: 1.5,
              display: "grid",
              gap: 4,
            }}
          >
            <div style={{ fontWeight: 700, color: "var(--foreground)" }}>
              📅 적용 시간표: <span style={{ color: "var(--primary-color, #2563eb)" }}>{formatRuleSummary(currentRules)}</span>
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
              * 현재 학생에게 설정된 시간표 패턴을 이어받아 총 {normalizeSessionAddCount(addedCount)}회차가 생성됩니다.
            </div>
            <div style={{ color: "#2563eb", fontSize: "0.82rem", marginTop: 2, fontWeight: 500 }}>
              💡 수업 요일이나 시간을 변경하시려면 상단의 [시간 변경] 버튼을 이용해 주세요.
            </div>
          </div>

          {error ? <div style={{ color: "#dc2626", fontSize: "0.9rem" }}>{error}</div> : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
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
                padding: "8px 18px",
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
