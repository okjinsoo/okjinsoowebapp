import { useMemo, useState } from "react";
import { PaymentRecord, Student } from "@/lib/types/index";
import { computeRefundRatio } from "@/lib/factories/lessonStatusFactory";
import { makeId } from "@/lib/utils/id";
import { nowIso, todayYmdKST } from "@/lib/utils/date";

export interface UseStudentPaymentProps {
    isAdmin: boolean;
    history: PaymentRecord[];
    applyHistory: (
        records: PaymentRecord[],
        basePatch?: Partial<Student>,
        skipSessions?: boolean
    ) => Promise<boolean>;
}

export function useStudentPayment({
    isAdmin,
    history,
    applyHistory,
}: UseStudentPaymentProps) {
    // Payment Panel State
    const [showPaymentPanel, setShowPaymentPanel] = useState(false);
    const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
    const [paymentDate, setPaymentDate] = useState(() => todayYmdKST());
    const [addedCount, setAddedCount] = useState<number>(12);
    const [paymentMemo, setPaymentMemo] = useState("");
    const [paymentConfirmed, setPaymentConfirmed] = useState(false);
    const [paymentError, setPaymentError] = useState("");

    // Refund Panel State
    const [refundOpen, setRefundOpen] = useState(false);
    const [refundMode, setRefundMode] = useState<"request" | "process">("request");
    const [refundRecordId, setRefundRecordId] = useState<string | null>(null);
    const [refundSessionInput, setRefundSessionInput] = useState<number | "">("");
    const [refundReasonInput, setRefundReasonInput] = useState("");
    const [refundConsultInput, setRefundConsultInput] = useState("");
    const [refundProcessedDate, setRefundProcessedDate] = useState(() => todayYmdKST());
    const [refundConfirmed, setRefundConfirmed] = useState(false);
    const [refundError, setRefundError] = useState("");

    const refundRecord = useMemo(
        () => history.find((h) => h.id === refundRecordId),
        [history, refundRecordId]
    );

    const editingRange = useMemo(() => {
        if (!editingRecordId) {
            if (history.length === 0) return { start: 1, end: addedCount };
            let lastEnd = 0;
            for (const h of history) {
                if (!h.refundStatus && h.endIndex > lastEnd) {
                    lastEnd = h.endIndex;
                } else if (h.refundStatus === "completed" && h.refundSessionIndex! - 1 > lastEnd) {
                    lastEnd = h.refundSessionIndex! - 1;
                }
            }
            return { start: lastEnd + 1, end: lastEnd + (Number(addedCount) || 0) };
        } else {
            const rec = history.find((h) => h.id === editingRecordId);
            if (!rec) return { start: 0, end: 0 };
            return { start: rec.startIndex, end: rec.startIndex + (Number(addedCount) || 0) - 1 };
        }
    }, [editingRecordId, history, addedCount]);

    function closePaymentPanel() {
        setShowPaymentPanel(false);
        setPaymentConfirmed(false);
        setPaymentError("");
        setPaymentMemo("");
        setEditingRecordId(null);
        setAddedCount(12);
        setPaymentDate(todayYmdKST());
    }

    function openEditPayment(record: PaymentRecord) {
        if (!isAdmin || record.isBase) return;
        setEditingRecordId(record.id);
        setPaymentDate(record.paymentDate);
        setAddedCount(record.addedCount);
        setPaymentMemo(record.memo ?? "");
        setPaymentConfirmed(false);
        setPaymentError("");
        setShowPaymentPanel(true);
    }

    function closeRefundPanel() {
        setRefundOpen(false);
        setRefundRecordId(null);
        setRefundSessionInput("");
        setRefundReasonInput("");
        setRefundConsultInput("");
        setRefundProcessedDate(todayYmdKST());
        setRefundConfirmed(false);
        setRefundError("");
    }

    async function onApplyPayment() {
        if (!isAdmin) return;
        setPaymentError("");

        const cnt = Math.floor(Number(addedCount));
        if (!paymentConfirmed) return setPaymentError("결제 확인을 먼저 체크해주세요.");
        if (!paymentDate) return setPaymentError("결제일을 입력해주세요.");
        if (!Number.isFinite(cnt) || cnt <= 0) return setPaymentError("추가 회차는 1 이상 숫자여야 합니다.");

        const record: PaymentRecord = {
            id: editingRecordId ?? makeId(),
            paymentDate,
            addedCount: cnt,
            startIndex: 0,
            endIndex: 0,
            memo: paymentMemo.trim() ? paymentMemo.trim() : undefined,
            createdAt: editingRecordId
                ? history.find((h) => h.id === editingRecordId)?.createdAt ?? nowIso()
                : nowIso(),
        };

        const nextHistory = editingRecordId
            ? history.map((h) => (h.id === editingRecordId ? record : h))
            : [...history, record];

        const ok = await applyHistory(nextHistory);
        if (!ok) return setPaymentError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");

        closePaymentPanel();
    }

    async function onDeletePaymentRecord() {
        if (!editingRecordId) return;
        const nextHistory = history.filter((h) => h.id !== editingRecordId);
        const ok = await applyHistory(nextHistory);
        if (!ok) return setPaymentError("삭제 처리에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        closePaymentPanel();
    }

    async function onSubmitRefundRequest() {
        if (!refundRecordId) return;
        setRefundError("");

        const record = refundRecord;
        if (!record) return;

        const req = Math.floor(Number(refundSessionInput));
        if (!Number.isFinite(req)) return setRefundError("환불 요청 회차를 입력해주세요.");
        if (req < record.startIndex || req > record.endIndex) {
            return setRefundError("환불 요청 회차는 해당 연장 구간 안이어야 합니다.");
        }
        if (!refundReasonInput.trim()) return setRefundError("환불 예상 사유를 입력해주세요.");

        const ratio = computeRefundRatio(record, req, Boolean(record.isBase));
        if (record.isBase) {
            const ok = await applyHistory(
                history,
                {
                    baseRefundStatus: "requested",
                    baseRefundSessionIndex: req,
                    baseRefundRatio: ratio,
                    baseRefundReason: refundReasonInput.trim(),
                    baseRefundRequestedAt: nowIso(),
                },
                true
            );
            if (!ok) return setRefundError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        } else {
            const nextHistory = history.map((h) =>
                h.id === record.id
                    ? {
                        ...h,
                        refundStatus: "requested" as const,
                        refundSessionIndex: req,
                        refundRatio: ratio,
                        refundReason: refundReasonInput.trim(),
                        refundRequestedAt: nowIso(),
                    }
                    : h
            );
            const ok = await applyHistory(nextHistory, undefined, true);
            if (!ok) return setRefundError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        }
        closeRefundPanel();
    }

    async function onSubmitRefundProcess() {
        if (!refundRecordId) return;
        setRefundError("");

        const record = refundRecord;
        if (!record) return;
        const req = Math.floor(Number(refundSessionInput));
        if (!Number.isFinite(req)) return setRefundError("환불 요청 회차를 입력해주세요.");
        if (req < record.startIndex || req > record.endIndex) {
            return setRefundError("환불 요청 회차는 해당 연장 구간 안이어야 합니다.");
        }
        if (!refundReasonInput.trim()) return setRefundError("환불 예상 사유를 입력해주세요.");
        if (!refundConsultInput.trim()) return setRefundError("상담 내용을 입력해주세요.");
        if (!refundProcessedDate) return setRefundError("환불 처리 날짜를 입력해주세요.");
        if (!refundConfirmed) return setRefundError("환불 처리 완료를 체크해주세요.");

        const ratio = computeRefundRatio(record, req, Boolean(record.isBase));

        if (record.isBase) {
            const ok = await applyHistory(
                history,
                {
                    baseRefundStatus: "completed",
                    baseRefundSessionIndex: req,
                    baseRefundRatio: ratio,
                    baseRefundReason: refundReasonInput.trim(),
                    baseRefundRequestedAt: record.refundRequestedAt ?? nowIso(),
                    baseRefundConsultNote: refundConsultInput.trim(),
                    baseRefundProcessedDate: refundProcessedDate,
                    baseRefundProcessedAt: nowIso(),
                },
                true
            );
            if (!ok) return setRefundError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        } else {
            const nextHistory = history.map((h) =>
                h.id === record.id
                    ? {
                        ...h,
                        refundStatus: "completed" as const,
                        refundSessionIndex: req,
                        refundRatio: ratio,
                        refundReason: refundReasonInput.trim(),
                        refundRequestedAt: h.refundRequestedAt ?? nowIso(),
                        refundConsultNote: refundConsultInput.trim(),
                        refundProcessedDate,
                        refundProcessedAt: nowIso(),
                    }
                    : h
            );
            const ok = await applyHistory(nextHistory, undefined, true);
            if (!ok) return setRefundError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        }
        closeRefundPanel();
    }

    async function onCancelRefundRequest() {
        if (!refundRecordId) return;
        const record = refundRecord;
        if (!record) return;

        if (record.isBase) {
            const ok = await applyHistory(
                history,
                {
                    baseRefundStatus: undefined,
                    baseRefundSessionIndex: undefined,
                    baseRefundRatio: undefined,
                    baseRefundReason: undefined,
                    baseRefundRequestedAt: undefined,
                    baseRefundProcessedAt: undefined,
                    baseRefundProcessedDate: undefined,
                    baseRefundConsultNote: undefined,
                },
                true
            );
            if (!ok) return setRefundError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        } else {
            const nextHistory = history.map((h) =>
                h.id === record.id
                    ? {
                        ...h,
                        refundStatus: undefined,
                        refundSessionIndex: undefined,
                        refundRatio: undefined,
                        refundReason: undefined,
                        refundRequestedAt: undefined,
                        refundProcessedAt: undefined,
                        refundProcessedDate: undefined,
                        refundConsultNote: undefined,
                    }
                    : h
            );
            const ok = await applyHistory(nextHistory, undefined, true);
            if (!ok) return setRefundError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
        }
        closeRefundPanel();
    }

    return {
        state: {
            showPaymentPanel,
            editingRecordId,
            paymentDate,
            addedCount,
            paymentMemo,
            paymentConfirmed,
            paymentError,
            refundOpen,
            refundMode,
            refundRecordId,
            refundSessionInput,
            refundReasonInput,
            refundConsultInput,
            refundProcessedDate,
            refundConfirmed,
            refundError,
        },
        derived: {
            refundRecord,
            editingRange,
        },
        actions: {
            setShowPaymentPanel,
            setPaymentDate,
            setAddedCount,
            setPaymentMemo,
            setPaymentConfirmed,
            setRefundOpen,
            setRefundMode,
            setRefundRecordId,
            setRefundSessionInput,
            setRefundReasonInput,
            setRefundConsultInput,
            setRefundProcessedDate,
            setRefundConfirmed,
            closePaymentPanel,
            openEditPayment,
            closeRefundPanel,
            onApplyPayment,
            onDeletePaymentRecord,
            onSubmitRefundRequest,
            onSubmitRefundProcess,
            onCancelRefundRequest,
        },
    };
}
