import { useState, useEffect } from "react";
import { ConsultationRecord, PaymentRecord, Session, Student } from "@/lib/types/index";
import { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { makeId } from "@/lib/utils/id";
import { nowIso, todayYmdKST } from "@/lib/utils/date";
import { buildConsultationRecord, normalizeConsultPurpose, validateConsultForm } from "@/lib/factories/consultationFactory";
import { computeRefundRatio } from "@/lib/factories/lessonStatusFactory";
import { useMetaMap } from "@/lib/factories/sessionFactories";
import { computePauseLifecycle } from "@/lib/factories/studentStatusFactory";
import { findClassIndexByDatePreferFuture } from "@/lib/ui/session/pauseHelpers";

export interface UseStudentConsultProps {
    isAdmin: boolean;
    student: Student | null;
    history: PaymentRecord[];
    consultRecords: ConsultationRecord[];
    token: string;
    sessions: Session[];
    baseDatesISO: string[];
    metaMap: ReturnType<typeof useMetaMap>;
    displayRecords: PaymentRecord[];
    applyHistory: (
        records: PaymentRecord[],
        basePatch?: Partial<Student>,
        skipSessions?: boolean,
        options?: { consultationRecords?: ConsultationRecord[] }
    ) => Promise<boolean>;
    persistConsultationState: (
        nextConsultRecords: ConsultationRecord[],
        nextStudentOverride?: Student
    ) => Promise<boolean>;
}

export function applyPauseStateFromConsultations(student: Student, records: ConsultationRecord[]): Student {
    const latestPause = [...records]
        .filter((r) => r.purpose === "pause_request" && (r.finalResult === "pause_confirm" || r.finalResult === "pause_cancel"))
        .sort((a, b) => {
            const ad = `${a.date ?? ""}|${a.createdAt ?? ""}`;
            const bd = `${b.date ?? ""}|${b.createdAt ?? ""}`;
            return ad.localeCompare(bd);
        })
        .at(-1);

    if (latestPause?.finalResult === "pause_confirm" && latestPause.pauseEffectiveDate) {
        const today = todayYmdKST();
        const pauseStatus = computePauseLifecycle(today, latestPause.pauseEffectiveDate) === "paused" ? "paused" : "confirmed";
        return {
            ...student,
            status: "paused",
            pauseEffectiveDate: latestPause.pauseEffectiveDate,
            pauseStatus,
        };
    }

    return {
        ...student,
        status: "active",
        pauseEffectiveDate: undefined,
        pauseStatus: "none",
    };
}

export function useStudentConsult({
    isAdmin,
    student,
    history,
    consultRecords,
    token,
    sessions,
    baseDatesISO,
    metaMap,
    displayRecords,
    applyHistory,
    persistConsultationState,
}: UseStudentConsultProps) {
    const [consultOpen, setConsultOpen] = useState(false);
    const [consultEditingId, setConsultEditingId] = useState<string | null>(null);
    const [consultForm, setConsultForm] = useState<ConsultFormState>({
        date: todayYmdKST(),
        purpose: "general",
        target: "student",
        content: "",
        adminConsultDate: "",
        extensionResult: "",
        extensionPaymentDate: todayYmdKST(),
        extensionAddedCount: 12,
        extensionPaymentConfirmed: false,
        finalNote: "",
        finalResult: "",
        pauseEffectiveDate: "",
        pauseRefundRatio: "",
        pauseRefundCompleted: false,
    });
    const [consultError, setConsultError] = useState("");

    function openConsultNew(purpose: "general" | "pause_request" | "extension" = "general") {
        setConsultEditingId(null);
        setConsultForm({
            date: todayYmdKST(),
            purpose,
            target: "student",
            content: "",
            adminConsultDate: "",
            extensionResult: "",
            extensionPaymentDate: todayYmdKST(),
            extensionAddedCount: 12,
            extensionPaymentConfirmed: false,
            finalNote: "",
            finalResult: "",
            pauseEffectiveDate: "",
            pauseRefundRatio: "",
            pauseRefundCompleted: false,
        });
        setConsultError("");
        setConsultOpen(true);
    }

    function openConsultEdit(record: ConsultationRecord) {
        setConsultEditingId(record.id);
        setConsultForm({
            date: record.date || todayYmdKST(),
            purpose: normalizeConsultPurpose((record as { purpose?: unknown }).purpose),
            target: record.target ?? "student",
            content: record.content ?? "",
            adminConsultDate: record.adminConsultDate ?? "",
            extensionResult: record.extensionResult ?? "",
            extensionPaymentDate: record.extensionPaymentDate ?? todayYmdKST(),
            extensionAddedCount: Math.max(1, Math.floor(Number(record.extensionAddedCount) || 12)),
            extensionPaymentConfirmed: Boolean(record.extensionPaymentConfirmed),
            finalNote: record.finalNote ?? "",
            finalResult: record.finalResult ?? "",
            pauseEffectiveDate: record.pauseEffectiveDate ?? "",
            pauseRefundRatio: record.pauseRefundRatio ?? "",
            pauseRefundCompleted: Boolean(record.pauseRefundCompleted),
        });
        setConsultError("");
        setConsultOpen(true);
    }

    function openConsultForSession(tag: { recordId: string } | null) {
        if (tag?.recordId) {
            const record = consultRecords.find((r) => r.id === tag.recordId);
            if (record) {
                openConsultEdit(record);
                return;
            }
        }
        openConsultNew();
    }

    async function saveConsultRecord() {
        if (!student) return;
        const err = validateConsultForm(consultForm, isAdmin);
        if (err) return setConsultError(err);
        const list = consultRecords ?? [];
        const { previous: existing, next, updated } = buildConsultationRecord({
            records: list,
            editingId: consultEditingId,
            form: consultForm,
            nowIso: nowIso(),
            makeId,
        });

        const wantsExtended = consultForm.purpose === "extension" && consultForm.extensionResult === "extended";
        const paymentConfirmed = Boolean(consultForm.extensionPaymentConfirmed);
        const prevApplied = Boolean(existing?.extensionAppliedAt && existing?.extensionPaymentRecordId);
        let nextStudentOverride: Student | undefined;

        let nextConsultRecords = updated;
        if (!wantsExtended || !paymentConfirmed) {
            nextConsultRecords = updated.map((r) =>
                r.id === next.id ? { ...r, extensionAppliedAt: undefined, extensionPaymentRecordId: undefined } : r
            );
        }

        if (isAdmin && consultForm.purpose === "pause_request") {
            if (consultForm.finalResult === "pause_confirm" && consultForm.pauseEffectiveDate) {
                const lastYmd = consultForm.pauseEffectiveDate;
                const lastIdx = findClassIndexByDatePreferFuture({
                    token,
                    sessions,
                    baseDatesISO,
                    metaMap,
                    targetDate: lastYmd,
                });
                const requestIndex = lastIdx ? lastIdx + 1 : null;
                const refundTarget =
                    requestIndex !== null
                        ? displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex)
                        : undefined;
                const pauseRefundRatio = refundTarget
                    ? computeRefundRatio(refundTarget, requestIndex as number, Boolean(refundTarget.isBase))
                    : undefined;

                nextConsultRecords = nextConsultRecords.map((r) =>
                    r.id === next.id
                        ? {
                            ...r,
                            pauseEffectiveDate: lastYmd,
                            pauseRefundRatio,
                            pauseRefundCompleted: Boolean(consultForm.pauseRefundCompleted),
                        }
                        : r
                );
            }

            nextStudentOverride = applyPauseStateFromConsultations(student, nextConsultRecords);
        }
        const nextStudentPatch = nextStudentOverride
            ? {
                status: nextStudentOverride.status,
                pauseEffectiveDate: nextStudentOverride.pauseEffectiveDate,
                pauseStatus: nextStudentOverride.pauseStatus,
            }
            : undefined;

        if (isAdmin && prevApplied && (!wantsExtended || !paymentConfirmed) && existing?.extensionPaymentRecordId) {
            const nextHistory = history.filter((h) => h.id !== existing.extensionPaymentRecordId);
            const ok = await applyHistory(nextHistory, nextStudentPatch, false, {
                consultationRecords: nextConsultRecords,
            });
            if (!ok) return;
            setConsultOpen(false);
            return;
        }

        if (isAdmin && wantsExtended && paymentConfirmed) {
            const cnt = Math.max(1, Math.floor(Number(consultForm.extensionAddedCount) || 0));
            const nextPaymentDate = consultForm.extensionPaymentDate;
            const nextMemo = consultForm.content.trim() || "연장 상담";
            let nextHistory: PaymentRecord[] | null = null;
            let refreshed = nextConsultRecords;

            if (prevApplied && existing?.extensionPaymentRecordId) {
                const recId = existing.extensionPaymentRecordId;
                const recIdx = history.findIndex((h) => h.id === recId);

                if (recIdx >= 0) {
                    const prev = history[recIdx];
                    const patched: PaymentRecord = {
                        ...prev,
                        paymentDate: nextPaymentDate,
                        addedCount: cnt,
                        memo: nextMemo,
                    };
                    nextHistory = history.map((h, i) => (i === recIdx ? patched : h));
                    refreshed = nextConsultRecords.map((r) =>
                        r.id === next.id
                            ? {
                                ...r,
                                extensionAppliedAt: r.extensionAppliedAt ?? existing.extensionAppliedAt ?? nowIso(),
                                extensionPaymentRecordId: recId,
                            }
                            : r
                    );
                } else {
                    const paymentRecord: PaymentRecord = {
                        id: makeId(),
                        paymentDate: nextPaymentDate,
                        addedCount: cnt,
                        startIndex: 0,
                        endIndex: 0,
                        memo: nextMemo,
                        createdAt: nowIso(),
                    };
                    nextHistory = [...history, paymentRecord];
                    refreshed = nextConsultRecords.map((r) =>
                        r.id === next.id ? { ...r, extensionAppliedAt: nowIso(), extensionPaymentRecordId: paymentRecord.id } : r
                    );
                }
            } else {
                const paymentRecord: PaymentRecord = {
                    id: makeId(),
                    paymentDate: nextPaymentDate,
                    addedCount: cnt,
                    startIndex: 0,
                    endIndex: 0,
                    memo: nextMemo,
                    createdAt: nowIso(),
                };
                nextHistory = [...history, paymentRecord];
                refreshed = nextConsultRecords.map((r) =>
                    r.id === next.id ? { ...r, extensionAppliedAt: nowIso(), extensionPaymentRecordId: paymentRecord.id } : r
                );
            }

            if (!nextHistory) {
                setConsultError("연장 결제 기록을 준비하지 못했어요. 다시 시도해주세요.");
                return;
            }
            const ok = await applyHistory(nextHistory, nextStudentPatch, false, {
                consultationRecords: refreshed,
            });
            if (!ok) return;
            setConsultOpen(false);
            return;
        }

        const ok = await persistConsultationState(nextConsultRecords, nextStudentOverride);
        if (!ok) return setConsultError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        setConsultOpen(false);
    }

    async function deleteConsultRecord() {
        if (!student || !consultEditingId) return;
        const list = consultRecords ?? [];
        const deleting = list.find((r) => r.id === consultEditingId);
        const updated = list.filter((r) => r.id !== consultEditingId);
        const nextStudentOverride =
            isAdmin && deleting?.purpose === "pause_request" ? applyPauseStateFromConsultations(student, updated) : undefined;
        const nextStudentPatch = nextStudentOverride
            ? {
                status: nextStudentOverride.status,
                pauseEffectiveDate: nextStudentOverride.pauseEffectiveDate,
                pauseStatus: nextStudentOverride.pauseStatus,
            }
            : undefined;

        if (deleting?.purpose === "extension" && deleting.extensionPaymentRecordId) {
            const nextHistory = history.filter((h) => h.id !== deleting.extensionPaymentRecordId);
            const ok = await applyHistory(nextHistory, nextStudentPatch, false, {
                consultationRecords: updated,
            });
            if (!ok) return;
        } else {
            const ok = await persistConsultationState(updated, nextStudentOverride);
            if (!ok) return setConsultError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        }

        setConsultOpen(false);
    }

    return {
        state: {
            consultOpen,
            consultEditingId,
            consultForm,
            consultError,
        },
        actions: {
            setConsultOpen,
            setConsultForm,
            openConsultNew,
            openConsultEdit,
            openConsultForSession,
            saveConsultRecord,
            deleteConsultRecord,
        }
    };
}
