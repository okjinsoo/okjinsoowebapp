import { useState, useMemo } from "react";
import Badge from "@/lib/ui/common/Badge";
import AutoResizeTextarea from "@/lib/ui/common/AutoResizeTextarea";
import { PaymentRecord, Student } from "@/lib/types/index";
import { refundRatioLabel, buildDisplayRecords } from "@/lib/factories/lessonStatusFactory";
import { useStudentPayment, UseStudentPaymentProps } from "../hooks/useStudentPayment";

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

const formatYmdDot = (ymd?: string) => {
    if (!ymd) return "-";
    return ymd.replace(/-/g, ".");
};

export interface StudentPaymentPanelProps extends UseStudentPaymentProps {
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
    const [actionMode, setActionMode] = useState<"edit" | null>(null);

    const { state, derived, actions } = useStudentPayment({
        isAdmin,
        history,
        applyHistory,
    });

    const displayRecords = useMemo(
        () => buildDisplayRecords(student, history, baseCount).displayRecords,
        [student, history, baseCount]
    );

    return (
        <>
            <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div className="card-title">결제 기록</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {isAdmin ? (
                            <button
                                className="btn btn-bold"
                                title="수정 모드"
                                onClick={() => setActionMode((prev) => (prev === "edit" ? null : "edit"))}
                            >
                                수정
                            </button>
                        ) : null}
                    </div>
                </div>
                {displayRecords.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", marginTop: 6 }}>기록이 없습니다.</div>
                ) : (
                    <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                        {displayRecords.map((h) => (
                            <div
                                key={h.id}
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
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "110px 90px 1fr",
                                        gap: 30,
                                        flex: "1 1 auto",
                                        alignItems: "center",
                                    }}
                                >
                                    <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatYmdDot(h.paymentDate)}</div>
                                    <div style={{ whiteSpace: "nowrap" }}>+{h.addedCount}회</div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", color: "#374151" }}>
                                        <span>
                                            {h.startIndex}회차 ~ {h.endIndex}회차
                                        </span>
                                        {h.refundStatus ? (
                                            <Badge
                                                style={{
                                                    background: h.refundStatus === "completed" ? "#fecaca" : "#fed7aa",
                                                    color: "#9a3412",
                                                }}
                                            >
                                                {h.refundStatus === "completed" ? "환불완료" : "환불요청"} · {h.refundSessionIndex ?? "-"}회차
                                                {` · ${refundRatioLabel(h.refundRatio)}`}
                                            </Badge>
                                        ) : null}
                                    </div>
                                </div>
                                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flex: "0 0 auto" }}>
                                    {actionMode === "edit" && isAdmin && !h.isBase ? (
                                        <button onClick={() => actions.openEditPayment(h)} className="btn btn-bold" title="수정">
                                            수정
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {isAdmin && state.showPaymentPanel ? (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: 16,
                        zIndex: 50,
                    }}
                >
                    <div
                        style={{
                            width: "100%",
                            maxWidth: 350,
                            background: "var(--surface-bg)",
                            border: "1px solid var(--surface-border)",
                            color: "var(--foreground)",
                            borderRadius: 12,
                            padding: 12,
                        }}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ fontWeight: 900 }}>
                                수업 현황 수정
                            </div>
                        </div>

                        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                                <div style={{ fontWeight: 800 }}>결제일</div>
                                <input
                                    type="date"
                                    value={state.paymentDate}
                                    onChange={(e) => actions.setPaymentDate(e.target.value)}
                                    style={inputStyle}
                                />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 10, alignItems: "center" }}>
                                <div style={{ fontWeight: 800 }}>추가회차</div>
                                <input
                                    type="number"
                                    min={1}
                                    value={state.addedCount}
                                    onChange={(e) => actions.setAddedCount(Number(e.target.value))}
                                    style={inputStyle}
                                />
                            </div>

                            <div style={{ color: "var(--text-muted)" }}>
                                적용 회차 :{" "}
                                {Number.isFinite(derived.editingRange.end) && derived.editingRange.end >= derived.editingRange.start
                                    ? `${derived.editingRange.start}회차 ~ ${derived.editingRange.end}회차`
                                    : "-"}
                            </div>

                            <div style={{ display: "grid", gap: 6 }}>
                                <div style={{ fontWeight: 800 }}>메모</div>
                                <AutoResizeTextarea
                                    rows={2}
                                    value={state.paymentMemo}
                                    placeholder="환불/결제 메모"
                                    onChange={(e) => actions.setPaymentMemo(e.target.value)}
                                    style={inputStyle}
                                />
                            </div>

                            <div style={{ height: 6 }} />

                            <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span>결제를 확인하셨습니까?</span>
                                <input
                                    type="checkbox"
                                    checked={state.paymentConfirmed}
                                    onChange={(e) => actions.setPaymentConfirmed(e.target.checked)}
                                />
                            </label>

                            {state.paymentError ? <div style={{ color: "#dc2626" }}>{state.paymentError}</div> : null}

                            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
                                <button
                                    onMouseEnter={(e) => (e.currentTarget.style.background = "#b91c1c")}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "#dc2626")}
                                    onClick={actions.onDeletePaymentRecord}
                                    style={{ ...boxButton, padding: "10px 14px", fontWeight: 800, color: "#fff", background: "#dc2626" }}
                                >
                                    삭제
                                </button>
                                <button
                                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                                    onClick={actions.closePaymentPanel}
                                    style={{ ...boxButton, padding: "10px 14px" }}
                                >
                                    취소
                                </button>
                                <button
                                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
                                    onClick={actions.onApplyPayment}
                                    style={{ ...boxButton, padding: "10px 14px", fontWeight: 800 }}
                                >
                                    저장
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : null}


        </>
    );
}
