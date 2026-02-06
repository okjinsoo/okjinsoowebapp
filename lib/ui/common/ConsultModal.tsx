"use client";

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

function refundRatioLabel(ratio: ConsultFormState["pauseRefundRatio"]) {
  if (ratio === "full") return "전액";
  if (ratio === "two_thirds") return "2/3";
  if (ratio === "half") return "1/2";
  if (ratio === "none") return "0";
  return "-";
}

export default function ConsultModal({
  open,
  role,
  state,
  error,
  onChange,
  onClose,
  onSave,
  onDelete,
  title = "상담 기록",
}: {
  open: boolean;
  role: Role;
  state: ConsultFormState;
  error?: string;
  onChange: (next: ConsultFormState) => void;
  onClose: () => void;
  onSave: () => void;
  onDelete?: () => void;
  title?: string;
}) {
  if (!open) return null;
  const isAdmin = role === "a";
  const isTeacher = role === "t";
  const isReadOnly = role === "s";

  const baseDisabled = isReadOnly;
  const pauseAdminLocked = isTeacher || isReadOnly;
  const lockedInputClass = pauseAdminLocked ? " bg-neutral-100 text-neutral-500" : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded bg-white p-4 shadow">
        <div className="card-title">{title}</div>

        <div className="mt-3 grid gap-3">
          <label className="grid gap-1">
            <div className="text-sm font-semibold">날짜</div>
            <input
              type="date"
              className="rounded border border-neutral-300 px-2 py-1"
              value={state.date}
              onChange={(e) => onChange({ ...state, date: e.target.value })}
              disabled={baseDisabled}
            />
          </label>

          <label className="grid gap-1">
            <div className="text-sm font-semibold">목적</div>
            <select
              className="rounded border border-neutral-300 px-2 py-1"
              value={state.purpose}
              onChange={(e) => onChange({ ...state, purpose: e.target.value as ConsultFormState["purpose"] })}
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
              value={state.target}
              onChange={(e) => onChange({ ...state, target: e.target.value as ConsultFormState["target"] })}
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
              value={state.content}
              onChange={(e) => onChange({ ...state, content: e.target.value })}
              placeholder="상담 내용을 입력해주세요"
              readOnly={baseDisabled}
            />
          </label>

          {state.purpose === "extension" ? (
            <>
              <label className="grid gap-1">
                <div className="text-sm font-semibold">결과</div>
                <select
                  className="rounded border border-neutral-300 px-2 py-1"
                  value={state.extensionResult}
                  onChange={(e) =>
                    onChange({ ...state, extensionResult: e.target.value as ConsultFormState["extensionResult"] })
                  }
                  disabled={baseDisabled}
                >
                  <option value="">선택 안함</option>
                  <option value="extended">연장</option>
                  <option value="not_extended">미연장</option>
                </select>
              </label>

              {state.extensionResult === "extended" ? (
                <>
                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">결제일</div>
                    <input
                      type="date"
                      className="rounded border border-neutral-300 px-2 py-1"
                      value={state.extensionPaymentDate}
                      onChange={(e) => onChange({ ...state, extensionPaymentDate: e.target.value })}
                      disabled={baseDisabled}
                    />
                  </label>

                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">추가 회차</div>
                    <input
                      type="number"
                      min={1}
                      className="rounded border border-neutral-300 px-2 py-1"
                      value={state.extensionAddedCount}
                      onChange={(e) =>
                        onChange({
                          ...state,
                          extensionAddedCount: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        })
                      }
                      disabled={baseDisabled}
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">결제 완료</span>
                    <input
                      type="checkbox"
                      checked={state.extensionPaymentConfirmed}
                      onChange={(e) => onChange({ ...state, extensionPaymentConfirmed: e.target.checked })}
                      disabled={baseDisabled}
                    />
                  </label>
                </>
              ) : null}
            </>
          ) : null}

          {state.purpose === "pause_request" ? (
            <>
              <label className="grid gap-1">
                <div className="text-sm font-semibold">관리자 상담일</div>
                <input
                  type="date"
                  className={`rounded border border-neutral-300 px-2 py-1${lockedInputClass}`}
                  value={state.adminConsultDate}
                  onChange={(e) => onChange({ ...state, adminConsultDate: e.target.value })}
                  disabled={pauseAdminLocked}
                />
              </label>

              <label className="grid gap-1">
                <div className="text-sm font-semibold">상담 결과</div>
                <select
                  className={`rounded border border-neutral-300 px-2 py-1${lockedInputClass}`}
                  value={state.finalResult}
                  onChange={(e) =>
                    onChange({ ...state, finalResult: e.target.value as ConsultFormState["finalResult"] })
                  }
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
                  className={`rounded border border-neutral-300 px-2 py-1${lockedInputClass}`}
                  value={state.finalNote}
                  onChange={(e) => onChange({ ...state, finalNote: e.target.value })}
                  placeholder="최종 상담 내용을 입력해주세요"
                  readOnly={pauseAdminLocked}
                />
              </label>

              {state.finalResult === "pause_confirm" ? (
                <>
                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">마지막 수업일</div>
                    <input
                      type="date"
                      className={`rounded border border-neutral-300 px-2 py-1${lockedInputClass}`}
                      value={state.pauseEffectiveDate}
                      onChange={(e) => onChange({ ...state, pauseEffectiveDate: e.target.value })}
                      disabled={pauseAdminLocked}
                    />
                  </label>

                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">환불 비율</div>
                    <input
                      type="text"
                      className={`rounded border border-neutral-300 px-2 py-1 bg-neutral-50${lockedInputClass}`}
                      value={refundRatioLabel(state.pauseRefundRatio)}
                      readOnly
                    />
                  </label>

                  <label className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">환불 완료</span>
                    <input
                      type="checkbox"
                      checked={state.pauseRefundCompleted}
                      onChange={(e) => onChange({ ...state, pauseRefundCompleted: e.target.checked })}
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
            <button className="btn btn-bold" onClick={onSave}>
              저장
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
