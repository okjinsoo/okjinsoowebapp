import { useState } from "react";
import { ConsultationRecord, PaymentRecord, Session, Student } from "@/lib/types/index";
import { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { todayYmdKST } from "@/lib/utils/date";
import { normalizeConsultPurpose } from "@/lib/factories/consultationFactory";
import { useMetaMap } from "@/lib/factories/sessionFactories";
import { computePauseLifecycle } from "@/lib/factories/studentStatusFactory";
import { findLastClassIndex } from "@/lib/ui/session/pauseHelpers";
import { computeRefundRatio } from "@/lib/factories/lessonStatusFactory";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";
import { useConsultationSubmit } from "./useConsultationSubmit";

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

    const { submit: submitConsult } = useConsultationSubmit({
        isAdmin,
        student,
        history,
        consultRecords: consultRecords ?? [],
        sessions,
        token,
        applyHistory,
        persistConsultationState,
    });

    // 실시간 환불 비율 계산을 위한 헬퍼 (모달에 주입용)
    const getLiveRefundRatio = (pauseDate: string) => {
        if (!student || !pauseDate) return "";
        const lastIdx = findLastClassIndex({
            token,
            sessions,
            baseDatesISO,
            metaMap,
            pauseEffectiveDate: pauseDate,
        });
        if (!lastIdx) return "";
        const requestIndex = lastIdx + 1;
        const refundTarget = displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex);
        return refundTarget
            ? computeRefundRatio(refundTarget, requestIndex, Boolean(refundTarget.isBase))
            : "";
    };

    async function saveConsultRecord(finalForm: ConsultFormState) {
        const res = await submitConsult(finalForm, consultEditingId);
        if (res.error) {
            setConsultError(res.error);
            return;
        }
        if (res.ok) {
            setConsultOpen(false);
        }
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
            if (!ok) return setConsultError(SERVER_SAVE_RETRY_MESSAGE);
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
            getLiveRefundRatio,
        }
    };
}
