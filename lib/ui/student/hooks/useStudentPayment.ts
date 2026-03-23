import { useMemo, useState } from "react";
import { PaymentRecord, Student } from "@/lib/types/index";
import { makeId } from "@/lib/utils/id";
import { nowIso, todayYmdKST } from "@/lib/utils/date";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";

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
        if (!ok) return setPaymentError(SERVER_SAVE_RETRY_MESSAGE);

        closePaymentPanel();
    }

    async function onDeletePaymentRecord() {
        if (!editingRecordId) return;
        const nextHistory = history.filter((h) => h.id !== editingRecordId);
        const ok = await applyHistory(nextHistory);
        if (!ok) return setPaymentError(SERVER_SAVE_RETRY_MESSAGE);
        closePaymentPanel();
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
        },
        derived: {
            editingRange,
        },
        actions: {
            setShowPaymentPanel,
            setPaymentDate,
            setAddedCount,
            setPaymentMemo,
            setPaymentConfirmed,
            closePaymentPanel,
            openEditPayment,
            onApplyPayment,
            onDeletePaymentRecord,
        },
    };
}
