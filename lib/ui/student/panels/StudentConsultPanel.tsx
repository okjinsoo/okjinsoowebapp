import { ConsultationRecord } from "@/lib/types/index";
import { useStudentConsult } from "../hooks/useStudentConsult";
import { canUseConsultFeatures } from "@/lib/policies/sessionRolePolicy";
import { type SessionRole as Role } from "@/lib/policies/sessionRolePolicy";
import Badge from "@/lib/ui/common/Badge";
import ConsultModal from "@/lib/ui/common/ConsultModal";
import { ConsultButton } from "@/lib/ui/common/ConsultParts";
import type { ConsultTag } from "@/lib/ui/session/consultationMap";

const formatYmdDot = (ymd?: string) => {
    if (!ymd) return "-";
    return ymd.replace(/-/g, ".");
};

export interface StudentConsultPanelProps {
    consultHooks: ReturnType<typeof useStudentConsult>;
    consultRecords: ConsultationRecord[];
    accessRole: Role;
    canEdit: boolean;
}

export function StudentConsultPanel({
    consultHooks,
    consultRecords,
    accessRole,
    canEdit,
}: StudentConsultPanelProps) {
    const { state, actions } = consultHooks;
    const canUseConsult = canUseConsultFeatures(accessRole);

    return (
        <>
            {canEdit && canUseConsult ? (
                <section style={{ marginTop: 12, border: "1px solid var(--surface-border)", borderRadius: 12, padding: 14, background: "var(--surface-bg)" }}>
                    <div className="card-title">상담 기록</div>
                    {consultRecords.length === 0 ? (
                        <div className="text-muted" style={{ marginTop: 8 }}>
                            상담 기록이 없습니다.
                        </div>
                    ) : (
                        <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                            {consultRecords.map((r) => (
                                <div
                                    key={r.id}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "110px 140px 120px 140px 120px auto",
                                        gap: 12,
                                        alignItems: "center",
                                        padding: "8px 10px",
                                        border: "1px solid var(--surface-border)",
                                        borderRadius: 8,
                                        background: "var(--surface-bg)",
                                    }}
                                >
                                    <div style={{ fontWeight: 700 }}>{formatYmdDot(r.date)}</div>
                                    <div>
                                        <Badge
                                            className={
                                                r.purpose === "pause_request"
                                                    ? "bg-orange-200 text-orange-900"
                                                    : r.purpose === "extension" && r.extensionResult === "extended"
                                                        ? "bg-blue-600 text-white"
                                                        : r.purpose === "extension" && r.extensionResult === "not_extended"
                                                            ? "bg-red-500 text-white"
                                                            : "bg-slate-200 text-slate-700"
                                            }
                                        >
                                            {r.purpose === "pause_request"
                                                ? "휴회 요청"
                                                : r.purpose === "extension"
                                                    ? r.extensionResult === "extended"
                                                        ? "연장 요청"
                                                        : r.extensionResult === "not_extended"
                                                            ? "미연장"
                                                            : "연장 상담"
                                                    : "일반 상담"}
                                        </Badge>
                                    </div>
                                    <div style={{ fontWeight: 700 }}>
                                        {r.purpose === "extension" && r.extensionResult === "extended"
                                            ? formatYmdDot(r.extensionPaymentDate)
                                            : r.purpose === "pause_request"
                                                ? formatYmdDot(r.adminConsultDate ?? r.pauseEffectiveDate)
                                                : ""}
                                    </div>
                                    <div>
                                        {r.purpose === "extension" && r.extensionResult === "extended" ? (
                                            <Badge tone={r.extensionPaymentConfirmed ? "blue" : "orange"}>
                                                {r.extensionPaymentConfirmed ? "결제 완료" : "결제 예정"}
                                            </Badge>
                                        ) : r.purpose === "pause_request" && r.finalResult ? (
                                            <Badge
                                                className={
                                                    r.finalResult === "pause_cancel"
                                                        ? "bg-orange-200 text-orange-900"
                                                        : "bg-red-500 text-white"
                                                }
                                            >
                                                {r.finalResult === "pause_cancel" ? "휴회 취소" : "휴회 확정"}
                                            </Badge>
                                        ) : (
                                            ""
                                        )}
                                    </div>
                                    <div>
                                        {r.purpose === "pause_request" && r.finalResult === "pause_confirm" ? (
                                            <Badge tone={r.pauseRefundCompleted ? "red" : "orange"}>
                                                {r.pauseRefundCompleted ? "환불 완료" : "환불 예정"}
                                            </Badge>
                                        ) : (
                                            ""
                                        )}
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                        {(() => {
                                            const tag: ConsultTag =
                                                r.purpose === "general"
                                                    ? {
                                                        purpose: "general",
                                                        target: "student",
                                                        label: "",
                                                        badgeClassName: "",
                                                        buttonClassName: "btn btn-gray",
                                                        recordId: r.id,
                                                    }
                                                    : r.purpose === "extension"
                                                        ? {
                                                            purpose: "extension",
                                                            target: "student",
                                                            label: "",
                                                            badgeClassName: "",
                                                            buttonClassName:
                                                                r.extensionResult === "extended"
                                                                    ? "btn btn-blue"
                                                                    : r.extensionResult === "not_extended"
                                                                        ? "btn btn-red"
                                                                        : "btn btn-gray",
                                                            recordId: r.id,
                                                        }
                                                        : {
                                                            purpose: "pause_request",
                                                            target: "student",
                                                            label: "",
                                                            badgeClassName: "",
                                                            buttonClassName: r.finalResult === "pause_confirm" ? "btn btn-red" : "btn btn-orange",
                                                            recordId: r.id,
                                                        };
                                            return <ConsultButton tag={tag} onClick={() => actions.openConsultEdit(r)} />;
                                        })()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            ) : null}

            {canUseConsult ? (
                <ConsultModal
                    open={state.consultOpen}
                    role={accessRole}
                    state={state.consultForm}
                    error={state.consultError}
                    onClose={() => actions.setConsultOpen(false)}
                    onSave={actions.saveConsultRecord}
                    onDelete={state.consultEditingId ? actions.deleteConsultRecord : undefined}
                    computeRefundRatioValue={actions.getLiveRefundRatio}
                />
            ) : null}
        </>
    );
}
