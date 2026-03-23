import React, { useState } from "react";
import AutoResizeTextarea from "@/lib/ui/common/AutoResizeTextarea";

type Role = "a" | "t" | "s";

export type ConsultFormState = {
  date: string;
  purpose: "general" | "pause_request" | "extension";
  target: "student" | "parent";
  content: string;
  adminConsultDate: string;
  extensionResult: "" | "extended" | "not_extended";
  extensionPaymentDate: string;
  extensionAddedCount: number;
  extensionPaymentConfirmed: boolean;
  finalNote: string;
  finalResult: "" | "pause_cancel" | "pause_confirm";
  pauseEffectiveDate: string;
  pauseRefundRatio: "" | "full" | "two_thirds" | "half" | "none";
  pauseRefundCompleted: boolean;
};

type ConsultModalProps = {
  open: boolean;
  role: Role;
  state: ConsultFormState;
  error?: string;
  onClose: () => void;
  onSave: (finalState: ConsultFormState) => void;
  onDelete?: () => void;
  title?: string;
  loading?: boolean;
  computeRefundRatioValue?: (pauseEffectiveDate: string) => string;
};

function refundRatioLabel(ratio: ConsultFormState["pauseRefundRatio"]) {
  if (ratio === "full") return "전액";
  if (ratio === "two_thirds") return "2/3";
  if (ratio === "half") return "1/2";
  if (ratio === "none") return "0";
  return "-";
}

function normalizeRefundRatio(value: string): ConsultFormState["pauseRefundRatio"] {
  if (value === "full") return "full";
  if (value === "two_thirds") return "two_thirds";
  if (value === "half") return "half";
  if (value === "none") return "none";
  return "";
}

function withComputedRefundRatio(
  state: ConsultFormState,
  computeRefundRatioValue?: (pauseEffectiveDate: string) => string
): ConsultFormState {
  if (
    state.purpose === "pause_request" &&
    state.finalResult === "pause_confirm" &&
    state.pauseEffectiveDate &&
    computeRefundRatioValue
  ) {
    const nextRatio = normalizeRefundRatio(computeRefundRatioValue(state.pauseEffectiveDate));
    if (nextRatio !== state.pauseRefundRatio) {
      return {
        ...state,
        pauseRefundRatio: nextRatio,
      };
    }
  }
  return state;
}

export default function ConsultModal(props: ConsultModalProps) {
  if (!props.open) return null;
  return (
    <OpenedConsultModal
      role={props.role}
      state={props.state}
      error={props.error}
      onClose={props.onClose}
      onSave={props.onSave}
      onDelete={props.onDelete}
      title={props.title}
      loading={props.loading}
      computeRefundRatioValue={props.computeRefundRatioValue}
    />
  );
}

function OpenedConsultModal({
  role,
  state: initialState,
  error,
  onClose,
  onSave: parentOnSave,
  onDelete,
  title = "상담 기록",
  loading,
  computeRefundRatioValue,
}: Omit<ConsultModalProps, "open">) {
  const [localState, setLocalState] = useState<ConsultFormState>(initialState);
  const finalState = withComputedRefundRatio(localState, computeRefundRatioValue);

  const handleChange = (next: ConsultFormState) => {
    setLocalState(next);
  };

  const handleSave = () => {
    parentOnSave(finalState);
  };
  const isAdmin = role === "a";
  const isTeacher = role === "t";
  const isReadOnly = role === "s";

  const baseDisabled = isReadOnly || loading;
  const pauseAdminLocked = isTeacher || isReadOnly || loading;
  const panelStyle = {
    background: "var(--surface-bg)",
    border: "1px solid var(--surface-border)",
    color: "var(--foreground)",
  };
  const baseFieldStyle = { borderColor: "var(--control-border)" };
  const lockedInputStyle = pauseAdminLocked
    ? { background: "var(--surface-hover)", color: "var(--text-muted)" }
    : {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded p-4 shadow" style={panelStyle}>
        <div className="card-title">{title}</div>

        <div className="mt-3 grid gap-3">
          <label className="grid gap-1">
            <div className="text-sm font-semibold">날짜</div>
            <input
              type="date"
              className="rounded border border-neutral-300 px-2 py-1"
              style={baseFieldStyle}
              value={localState.date}
              onChange={(e) => handleChange({ ...localState, date: e.target.value })}
              disabled={baseDisabled}
            />
          </label>

          <label className="grid gap-1">
            <div className="text-sm font-semibold">목적</div>
            <select
              className="rounded border border-neutral-300 px-2 py-1"
              style={baseFieldStyle}
              value={localState.purpose}
              onChange={(e) => handleChange({ ...localState, purpose: e.target.value as ConsultFormState["purpose"] })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }
              }}
              disabled={baseDisabled}
            >
              <option value="general">일반 상담</option>
              {role !== "t" ? <option value="extension">연장 요청</option> : null}
              <option value="pause_request">휴회 요청</option>
            </select>
          </label>

          <label className="grid gap-1">
            <div className="text-sm font-semibold">대상</div>
            <select
              className="rounded border border-neutral-300 px-2 py-1"
              style={baseFieldStyle}
              value={localState.target}
              onChange={(e) => handleChange({ ...localState, target: e.target.value as ConsultFormState["target"] })}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }
              }}
              disabled={baseDisabled}
            >
              <option value="student">학생</option>
              <option value="parent">학부모</option>
            </select>
          </label>

          <label className="grid gap-1">
            <div className="text-sm font-semibold">상담 내용</div>
            <AutoResizeTextarea
              className="rounded border border-neutral-300 px-2 py-1"
              style={baseFieldStyle}
              value={localState.content}
              onChange={(e) => handleChange({ ...localState, content: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }
              }}
              placeholder="상담 내용을 입력해주세요"
              readOnly={baseDisabled}
            />
          </label>

          {localState.purpose === "extension" ? (
            <>
              <label className="grid gap-1">
                <div className="text-sm font-semibold">결과</div>
                <select
                  className="rounded border border-neutral-300 px-2 py-1"
                  style={baseFieldStyle}
                  value={localState.extensionResult}
                  onChange={(e) =>
                    handleChange({ ...localState, extensionResult: e.target.value as ConsultFormState["extensionResult"] })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSave();
                    }
                  }}
                  disabled={baseDisabled}
                >
                  <option value="">선택 안함</option>
                  <option value="extended">연장</option>
                  <option value="not_extended">미연장</option>
                </select>
              </label>

              {localState.extensionResult === "extended" ? (
                <>
                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">결제일</div>
                    <input
                      type="date"
                      className="rounded border border-neutral-300 px-2 py-1"
                      style={baseFieldStyle}
                      value={localState.extensionPaymentDate}
                      onChange={(e) => handleChange({ ...localState, extensionPaymentDate: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSave();
                        }
                      }}
                      disabled={baseDisabled}
                    />
                  </label>

                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">추가 회차</div>
                    <input
                      type="number"
                      min={1}
                      className="rounded border border-neutral-300 px-2 py-1"
                      style={baseFieldStyle}
                      value={localState.extensionAddedCount}
                      onChange={(e) =>
                        handleChange({
                          ...localState,
                          extensionAddedCount: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSave();
                        }
                      }}
                      disabled={baseDisabled}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">결제 완료</span>
                    <input
                      type="checkbox"
                      checked={localState.extensionPaymentConfirmed}
                      onChange={(e) => handleChange({ ...localState, extensionPaymentConfirmed: e.target.checked })}
                      disabled={baseDisabled}
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}

          {localState.purpose === "pause_request" ? (
            <>
              <label className="grid gap-1">
                <div className="text-sm font-semibold">관리자 상담일</div>
                <input
                  type="date"
                  className="rounded border border-neutral-300 px-2 py-1"
                  style={{ ...baseFieldStyle, ...lockedInputStyle }}
                  value={localState.adminConsultDate}
                  onChange={(e) => handleChange({ ...localState, adminConsultDate: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSave();
                    }
                  }}
                  disabled={pauseAdminLocked}
                />
              </label>

              <label className="grid gap-1">
                <div className="text-sm font-semibold">상담 결과</div>
                <select
                  className="rounded border border-neutral-300 px-2 py-1"
                  style={{ ...baseFieldStyle, ...lockedInputStyle }}
                  value={localState.finalResult}
                  onChange={(e) =>
                    handleChange({ ...localState, finalResult: e.target.value as ConsultFormState["finalResult"] })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSave();
                    }
                  }}
                  disabled={pauseAdminLocked}
                >
                  <option value="">선택 안함</option>
                  <option value="pause_cancel">휴회 취소</option>
                  <option value="pause_confirm">휴회 확정</option>
                </select>
              </label>

              <label className="grid gap-1">
                <div className="text-sm font-semibold">최종상담</div>
                <AutoResizeTextarea
                  className="rounded border border-neutral-300 px-2 py-1"
                  style={{ ...baseFieldStyle, ...lockedInputStyle }}
                  value={localState.finalNote}
                  onChange={(e) => handleChange({ ...localState, finalNote: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSave();
                    }
                  }}
                  placeholder="최종 상담 내용을 입력해주세요"
                  readOnly={pauseAdminLocked}
                />
              </label>

              {localState.finalResult === "pause_confirm" ? (
                <>
                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">마지막 수업일</div>
                    <input
                      type="date"
                      className="rounded border border-neutral-300 px-2 py-1"
                      style={{ ...baseFieldStyle, ...lockedInputStyle }}
                      value={localState.pauseEffectiveDate}
                      onChange={(e) => handleChange({ ...localState, pauseEffectiveDate: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleSave();
                        }
                      }}
                      disabled={pauseAdminLocked}
                    />
                  </label>

                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">환불 비율</div>
                    <input
                      type="text"
                      className="rounded border border-neutral-300 px-2 py-1"
                      style={{
                        ...baseFieldStyle,
                        background: "var(--surface-hover)",
                        color: pauseAdminLocked ? "var(--text-muted)" : "var(--foreground)",
                      }}
                      value={refundRatioLabel(finalState.pauseRefundRatio)}
                      readOnly
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">환불 완료</span>
                    <input
                      type="checkbox"
                      checked={localState.pauseRefundCompleted}
                      onChange={(e) => handleChange({ ...localState, pauseRefundCompleted: e.target.checked })}
                      disabled={pauseAdminLocked}
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}

          {error ? <div style={{ color: "#dc2626" }}>{error}</div> : null}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {isAdmin && onDelete ? (
            <button className="btn btn-red" onClick={onDelete}>
              삭제
            </button>
          ) : null}
          <button className="btn" onClick={onClose}>
            취소
          </button>
          {isReadOnly ? null : (
            <button className="btn btn-bold" onClick={handleSave} disabled={loading}>
              {loading ? "적용 중..." : "저장"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
