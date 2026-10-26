import { useMemo, useState } from "react";
import type { PaymentRecord, Student } from "@/lib/types/index";
import { buildDisplayRecords, normalizePaymentHistoryRanges } from "@/lib/factories/lessonStatusFactory";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";
import { makeId } from "@/lib/utils/id";
import { nowIso, todayYmdKST } from "@/lib/utils/date";

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

const BASE_SPLIT_MEMO = "[자동분리] 기본회차 분리보정";

const formatYmdDot = (ymd?: string) => {
  if (!ymd) return "-";
  return ymd.replace(/-/g, ".");
};

type SessionAddRuleView = {
  weekday: number;
  hour: number;
  minute?: number;
  durationHour: 0.5 | 1 | 1.5 | 2 | 2.5 | 3;
};

const DEFAULT_RULE: SessionAddRuleView = {
  weekday: 1,
  hour: 17,
  minute: 0,
  durationHour: 1,
};

function normalizeHour(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(23, Math.floor(value)));
}

function normalizeMinute(value: number | undefined): number {
  if (!Number.isFinite(Number(value))) return 0;
  return Number(value) >= 30 ? 30 : 0;
}

function normalizeWeeklyCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(7, Math.floor(value)));
}

function normalizeDurationHour(value: number): 0.5 | 1 | 1.5 | 2 | 2.5 | 3 {
  if (!Number.isFinite(value)) return 1;
  if (value <= 0.75) return 0.5;
  if (value <= 1.25) return 1;
  if (value <= 1.75) return 1.5;
  if (value <= 2.25) return 2;
  if (value <= 2.75) return 2.5;
  return 3;
}


function readRulesFromRecord(record: PaymentRecord): SessionAddRuleView[] {
  const raw = Array.isArray(record.sessionAddRules) ? record.sessionAddRules : [];
  return raw
    .map((rule) => ({
      weekday: Math.max(0, Math.min(6, Math.floor(Number(rule.weekday) || 0))),
      hour: normalizeHour(Number(rule.hour)),
      minute: normalizeMinute(rule.minute),
      durationHour: normalizeDurationHour(Number(rule.durationHour)),
    }))
    .slice(0, 7);
}

function findScheduleEventByStartIndex(student: Student, record: PaymentRecord) {
  return (student.scheduleChangeEvents ?? []).find((item) => item.startIndex === record.startIndex) ?? null;
}

function readRulesFromScheduleEvent(student: Student, record: PaymentRecord): SessionAddRuleView[] {
  const event = findScheduleEventByStartIndex(student, record);
  if (!event || !Array.isArray(event.newRules)) return [];
  return event.newRules
    .map((rule) => {
      const durationMin =
        Number.isFinite(Number(rule.durationMin)) && Number(rule.durationMin) > 0
          ? Number(rule.durationMin)
          : 60;
      return {
        weekday: Math.max(0, Math.min(6, Math.floor(Number(rule.weekday) || 0))),
        hour: normalizeHour(Number(rule.hour)),
        minute: normalizeMinute(rule.minute),
        durationHour: normalizeDurationHour(durationMin / 60),
      };
    })
    .slice(0, 7);
}

function resolveSessionAddSummary(student: Student, record: PaymentRecord) {
  const matchedEvent = findScheduleEventByStartIndex(student, record);
  const rulesFromRecord = readRulesFromRecord(record);
  const rulesFromEvent = readRulesFromScheduleEvent(student, record);
  const resolvedRules = rulesFromRecord.length > 0 ? rulesFromRecord : rulesFromEvent;
  const weeklyCount = normalizeWeeklyCount(Number(record.sessionAddWeeklyCount) || resolvedRules.length || 1);
  const startDate = record.sessionAddStartDate || matchedEvent?.startDate || record.paymentDate;
  return {
    startDate,
    addedCount: Math.max(0, Math.floor(Number(record.addedCount) || 0)),
    weeklyCount,
    rules: resolvedRules.slice(0, weeklyCount),
  };
}

function normalizeRule(rule: SessionAddRuleView): SessionAddRuleView {
  return {
    weekday: Math.max(0, Math.min(6, Math.floor(Number(rule.weekday) || 0))),
    hour: normalizeHour(Number(rule.hour)),
    minute: normalizeMinute(rule.minute),
    durationHour: normalizeDurationHour(Number(rule.durationHour)),
  };
}

function buildRulesByCount(count: number, source: SessionAddRuleView[]): SessionAddRuleView[] {
  const normalizedCount = normalizeWeeklyCount(count);
  const seed = source.length > 0 ? source.map((rule) => normalizeRule(rule)) : [DEFAULT_RULE];
  const out: SessionAddRuleView[] = [];
  for (let i = 0; i < normalizedCount; i++) {
    out.push(seed[i] ?? seed[i % seed.length] ?? DEFAULT_RULE);
  }
  return out;
}

type ApplyHistoryFn = (
  records: PaymentRecord[],
  basePatch?: Partial<Student>,
  skipSessions?: boolean,
  options?: {
    baseCountOverride?: number;
  }
) => Promise<boolean>;

export interface StudentPaymentPanelProps {
  isAdmin: boolean;
  history: PaymentRecord[];
  applyHistory: ApplyHistoryFn;
  student: Student;
  baseCount: number;
}

export function StudentPaymentPanel({
  isAdmin,
  history,
  applyHistory,
  student,
  baseCount,
}: StudentPaymentPanelProps) {
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editStartDate, setEditStartDate] = useState("");
  const [editAddedCount, setEditAddedCount] = useState(1);
  const [editWeeklyCount, setEditWeeklyCount] = useState(1);
  const [editRules, setEditRules] = useState<SessionAddRuleView[]>([DEFAULT_RULE]);
  const [editError, setEditError] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitBaseCount, setSplitBaseCount] = useState(1);
  const [splitError, setSplitError] = useState("");
  const [splitSaving, setSplitSaving] = useState(false);

  const displayRecords = useMemo(
    () => buildDisplayRecords(student, history, baseCount).displayRecords,
    [student, history, baseCount]
  );

  const editingRangeLabel = useMemo(() => {
    if (!editingRecordId) return "-";
    const target = history.find((record) => record.id === editingRecordId);
    if (!target) return "-";
    const weeklyCount = normalizeWeeklyCount(editWeeklyCount);
    const patchedRecord: PaymentRecord = {
      ...target,
      paymentDate: editStartDate,
      addedCount: Math.max(1, Math.floor(Number(editAddedCount) || 1)),
      startIndex: 0,
      endIndex: 0,
      sessionAddStartDate: editStartDate,
      sessionAddWeeklyCount: weeklyCount,
      sessionAddRules: editRules
        .slice(0, weeklyCount)
        .map((rule) => normalizeRule(rule)),
    };
    const nextHistory = history.map((record) => (record.id === editingRecordId ? patchedRecord : record));
    const normalized = normalizePaymentHistoryRanges(nextHistory, baseCount);
    const matched = normalized.find((record) => record.id === editingRecordId);
    if (!matched) return "-";
    return `${matched.startIndex}회차 ~ ${matched.endIndex}회차`;
  }, [editingRecordId, history, baseCount, editStartDate, editAddedCount, editWeeklyCount, editRules]);
  const splitAddedCount = Math.max(0, baseCount - Math.max(1, Math.floor(Number(splitBaseCount) || 1)));

  function closeEditModal() {
    if (editSaving) return;
    setEditOpen(false);
    setEditingRecordId(null);
    setEditError("");
    setEditSaving(false);
  }

  function inferSuggestedBaseCount() {
    const eventStarts = (student.scheduleChangeEvents ?? [])
      .map((event) => Math.floor(Number(event.startIndex) || 0))
      .filter((startIndex) => Number.isFinite(startIndex) && startIndex > 1)
      .sort((a, b) => a - b);
    const firstEvent = eventStarts[0];
    if (firstEvent) {
      const candidate = firstEvent - 1;
      if (candidate >= 1 && candidate < baseCount) {
        return candidate;
      }
    }
    return 1;
  }

  function openSplitModal() {
    if (!isAdmin || baseCount <= 1) return;
    setSplitBaseCount(inferSuggestedBaseCount());
    setSplitError("");
    setSplitSaving(false);
    setSplitOpen(true);
  }

  function closeSplitModal() {
    if (splitSaving) return;
    setSplitOpen(false);
    setSplitError("");
    setSplitSaving(false);
  }

  async function onApplySplit() {
    if (!isAdmin) return;
    setSplitError("");
    const targetBase = Math.max(1, Math.floor(Number(splitBaseCount) || 1));
    if (baseCount <= 1) {
      setSplitError("기본회차가 1회 이하이면 분리보정이 필요하지 않습니다.");
      return;
    }
    if (targetBase >= baseCount) {
      setSplitError(`기본회차는 ${baseCount - 1}회 이하로 입력해주세요.`);
      return;
    }

    const splitCount = baseCount - targetBase;
    if (splitCount <= 0) {
      setSplitError("분리할 회차 수를 계산하지 못했습니다.");
      return;
    }

    const existingSplit = history.find((record) => record.memo === BASE_SPLIT_MEMO);
    const splitRecord: PaymentRecord = {
      ...(existingSplit ?? {
        id: makeId(),
        createdAt: nowIso(),
      }),
      paymentDate: student.startDate || todayYmdKST(),
      addedCount: splitCount,
      startIndex: 0,
      endIndex: 0,
      memo: BASE_SPLIT_MEMO,
      sessionAddStartDate: student.startDate || todayYmdKST(),
      sessionAddWeeklyCount: undefined,
      sessionAddRules: undefined,
    };
    const rest = history.filter((record) => record.id !== existingSplit?.id);
    const nextHistory = [splitRecord, ...rest];

    setSplitSaving(true);
    const ok = await applyHistory(nextHistory, undefined, false, {
      baseCountOverride: targetBase,
    });
    setSplitSaving(false);
    if (!ok) {
      setSplitError(SERVER_SAVE_RETRY_MESSAGE);
      return;
    }
    closeSplitModal();
  }

  function openEditModal(record: PaymentRecord) {
    if (!isAdmin || record.isBase) return;
    const summary = resolveSessionAddSummary(student, record);
    const weeklyCount = normalizeWeeklyCount(summary.weeklyCount);
    const initialRules = buildRulesByCount(weeklyCount, summary.rules);
    setEditingRecordId(record.id);
    setEditStartDate(summary.startDate);
    setEditAddedCount(Math.max(1, Math.floor(Number(summary.addedCount) || 1)));
    setEditWeeklyCount(weeklyCount);
    setEditRules(initialRules);
    setEditError("");
    setEditSaving(false);
    setEditOpen(true);
  }


  async function onApplyEdit() {
    if (!editingRecordId) return;
    setEditError("");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(editStartDate)) {
      setEditError("시작일을 정확히 입력해주세요.");
      return;
    }
    const nextCount = Math.max(1, Math.floor(Number(editAddedCount) || 0));
    if (nextCount < 1) {
      setEditError("회차수는 1 이상이어야 합니다.");
      return;
    }

    const previous = history.find((record) => record.id === editingRecordId);
    if (!previous) {
      setEditError("수정할 기록을 찾지 못했습니다.");
      return;
    }

    const updated: PaymentRecord = {
      ...previous,
      paymentDate: editStartDate,
      addedCount: nextCount,
      startIndex: 0,
      endIndex: 0,
      sessionAddStartDate: editStartDate,
      memo: `회차 추가(${nextCount}회)`,
    };
    const nextHistory = history.map((record) => (record.id === editingRecordId ? updated : record));

    setEditSaving(true);
    const ok = await applyHistory(nextHistory);
    setEditSaving(false);
    if (!ok) {
      setEditError(SERVER_SAVE_RETRY_MESSAGE);
      return;
    }
    closeEditModal();
  }

  async function onDeleteEdit() {
    if (!editingRecordId) return;
    setEditError("");
    setEditSaving(true);
    const nextHistory = history.filter((record) => record.id !== editingRecordId);
    const ok = await applyHistory(nextHistory);
    setEditSaving(false);
    if (!ok) {
      setEditError(SERVER_SAVE_RETRY_MESSAGE);
      return;
    }
    closeEditModal();
  }

  return (
    <>
      <section
        style={{
          marginTop: 14,
          border: "1px solid var(--surface-border)",
          borderRadius: 12,
          padding: 14,
          background: "var(--surface-bg)",
        }}
      >
        <div className="card-title">회차 추가 기록</div>
        {displayRecords.length === 0 ? (
          <div style={{ color: "var(--text-muted)", marginTop: 6 }}>기록이 없습니다.</div>
        ) : (
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {displayRecords.map((record) => {
              const summary = resolveSessionAddSummary(student, record);
              return (
                <div
                  key={record.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--surface-border)",
                    borderRadius: 8,
                    background: "var(--surface-bg)",
                  }}
                >
                  <div style={{ display: "flex", gap: 40, flexWrap: "wrap", flex: "1 1 auto" }}>
                    <span style={{ fontWeight: 800 }}>{record.isBase ? "기본회차" : "회차추가"}</span>
                    <span>{formatYmdDot(summary.startDate)}</span>
                    <span>{summary.addedCount}회</span>
                    <span>{record.startIndex}회차 ~ {record.endIndex}회차</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flex: "0 0 auto" }}>
                    {record.isBase ? (
                      <button
                        onClick={openSplitModal}
                        className="btn btn-bold"
                        title="기본회차 분리보정"
                        disabled={!isAdmin || baseCount <= 1}
                      >
                        분리보정
                      </button>
                    ) : (
                      <button
                        onClick={() => openEditModal(record)}
                        className="btn btn-bold"
                        title="회차 추가 기록 수정"
                        disabled={!isAdmin}
                      >
                        수정
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {isAdmin && editOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 80,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 560,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
              borderRadius: 12,
              padding: 12,
            }}
          >
            <div style={{ fontWeight: 900 }}>회차 추가 수정</div>
            <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
              시작일 기준으로 시간표 패턴을 적용해 입력한 회차 수만큼 생성합니다.
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>시작일</div>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
                <div style={{ fontWeight: 800 }}>회차수</div>
                <input
                  type="number"
                  min={1}
                  value={editAddedCount}
                  onChange={(e) => setEditAddedCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  style={inputStyle}
                />
              </div>

              <div
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "var(--background)",
                  border: "1px solid var(--surface-border)",
                  fontSize: "0.85rem",
                  color: "#2563eb",
                  fontWeight: 500,
                  marginTop: 2,
                }}
              >
                💡 수업 요일이나 시간을 변경하시려면 상단의 [시간 변경] 버튼을 이용해 주세요.
              </div>

              <div style={{ color: "var(--text-muted)" }}>생성 회차 범위 : {editingRangeLabel}</div>

              {editError ? <div style={{ color: "#dc2626" }}>{editError}</div> : null}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#b91c1c")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#dc2626")}
                  onClick={onDeleteEdit}
                  style={{ ...boxButton, padding: "8px 12px", color: "#fff", background: "#dc2626" }}
                  disabled={editSaving}
                >
                  삭제
                </button>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={closeEditModal}
                  style={{ ...boxButton, padding: "8px 12px" }}
                  disabled={editSaving}
                >
                  취소
                </button>
                <button
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                  onClick={onApplyEdit}
                  style={{ ...boxButton, padding: "8px 12px", fontWeight: 600 }}
                  disabled={editSaving}
                >
                  {editSaving ? "적용 중..." : "적용"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin && splitOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 81,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 480,
              background: "var(--surface-bg)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
              borderRadius: 12,
              padding: 12,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 900 }}>기본회차 분리보정</div>
            <div style={{ color: "var(--text-muted)" }}>
              현재 기본회차를 줄이고, 줄어든 수만큼 회차추가 기록을 자동으로 생성합니다.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>기본회차</div>
              <input
                type="number"
                min={1}
                max={Math.max(1, baseCount - 1)}
                value={splitBaseCount}
                onChange={(e) => setSplitBaseCount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                style={inputStyle}
              />
            </div>

            <div style={{ color: "var(--text-muted)" }}>
              자동 생성 회차추가: +{splitAddedCount}회
            </div>

            {splitError ? <div style={{ color: "#dc2626" }}>{splitError}</div> : null}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                onClick={closeSplitModal}
                style={{ ...boxButton, padding: "8px 12px" }}
                disabled={splitSaving}
              >
                취소
              </button>
              <button
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                onClick={onApplySplit}
                style={{ ...boxButton, padding: "8px 12px", fontWeight: 600 }}
                disabled={splitSaving}
              >
                {splitSaving ? "적용 중..." : "적용"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
