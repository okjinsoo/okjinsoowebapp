// v1/lib/ui/student/hooks/useConsultationSubmit.ts
"use client";

import { ConsultationRecord, PaymentRecord, Session, Student } from "@/lib/types/index";
import { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { validateConsultForm, buildConsultationRecord } from "@/lib/factories/consultationFactory";
import { nowIso } from "@/lib/utils/date";
import { makeId } from "@/lib/utils/id";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";
import { applyPauseStateFromConsultations } from "./useStudentConsult";

export interface ConsultationSubmitContext {
    isAdmin: boolean;
    student: Student | null;
    history: PaymentRecord[];
    consultRecords: ConsultationRecord[];
    sessions: Session[];
    token: string;
    // External save/apply functions provided by the component or a higher-level hook
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

export async function submitConsultation(ctx: ConsultationSubmitContext, form: ConsultFormState, editingId: string | null): Promise<{ ok: boolean; error?: string }> {
    const {
        isAdmin,
        student,
        history,
        consultRecords,
        applyHistory,
        persistConsultationState,
    } = ctx;

    if (!student) return { ok: false, error: "학생 정보를 찾을 수 없습니다." };

    console.log("DEBUG: submitConsultation START", { isAdmin, purpose: form.purpose, extensionResult: form.extensionResult, confirmed: form.extensionPaymentConfirmed });
    const err = validateConsultForm(form, isAdmin);
    if (err) {
        console.log("DEBUG: validateConsultForm ERROR", err);
        return { ok: false, error: err };
    }

    const list = consultRecords ?? [];
    const { previous: existing, next, updated } = buildConsultationRecord({
        records: list,
        editingId,
        form,
        nowIso: nowIso(),
        makeId,
    });

    const wantsExtended = form.purpose === "extension" && form.extensionResult === "extended";
    const paymentConfirmed = Boolean(form.extensionPaymentConfirmed);
    const prevApplied = Boolean(existing?.extensionAppliedAt && existing?.extensionPaymentRecordId);

    let nextStudentOverride: Student | undefined;
    let nextConsultRecords = updated;

    // Ensure consistency for newly added or unconfirmed extensions
    if (!wantsExtended || !paymentConfirmed) {
        nextConsultRecords = updated.map((r) =>
            r.id === next.id ? { ...r, extensionAppliedAt: undefined, extensionPaymentRecordId: undefined } : r
        );
    }

    // Handle Status Updates (Pause request)
    if (isAdmin && form.purpose === "pause_request") {
        nextStudentOverride = applyPauseStateFromConsultations(student, nextConsultRecords);
    }

    const nextStudentPatch = nextStudentOverride
        ? {
            status: nextStudentOverride.status,
            pauseEffectiveDate: nextStudentOverride.pauseEffectiveDate,
            pauseStatus: nextStudentOverride.pauseStatus,
        }
        : undefined;

    // Case 1: Un-confirming a previously confirmed extension
    if (isAdmin && prevApplied && (!wantsExtended || !paymentConfirmed) && existing?.extensionPaymentRecordId) {
        const nextHistory = history.filter((h) => h.id !== existing.extensionPaymentRecordId);
        const ok = await applyHistory(nextHistory, nextStudentPatch, false, {
            consultationRecords: nextConsultRecords,
        });
        return { ok };
    }

    // Case 2: Confirming/Updating a confirmed extension
    if (isAdmin && wantsExtended && paymentConfirmed) {
        const cnt = Math.max(1, Math.floor(Number(form.extensionAddedCount) || 0));
        const nextPaymentDate = form.extensionPaymentDate;
        const nextMemo = form.content.trim() || "연장 상담";
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
            }
        }

        if (!nextHistory) {
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

        const ok = await applyHistory(nextHistory, nextStudentPatch, false, {
            consultationRecords: refreshed,
        });
        return { ok };
    }

    // Case 3: Just persisting consultation records (Regular consults, Unpaid extensions, etc.)
    const ok = await persistConsultationState(nextConsultRecords, nextStudentOverride);
    if (!ok) return { ok: false, error: SERVER_SAVE_RETRY_MESSAGE };
    return { ok: true };
}

export function useConsultationSubmit(ctx: ConsultationSubmitContext) {
    async function submit(form: ConsultFormState, editingId: string | null): Promise<{ ok: boolean; error?: string }> {
        return submitConsultation(ctx, form, editingId);
    }

    return { submit };
}
