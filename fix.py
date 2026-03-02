import re

with open("lib/ui/student/StudentHubCore.tsx", "r") as f:
    text = f.read()

# 1. Re-add computeRefundRatio
text = text.replace(
    '  normalizePaymentHistoryRanges,\n} from "@/lib/factories/lessonStatusFactory";',
    '  normalizePaymentHistoryRanges,\n  computeRefundRatio,\n} from "@/lib/factories/lessonStatusFactory";'
)

# 2. Add refreshTick and teachers
text = text.replace(
    '  const [consultOpen, setConsultOpen] = useState(false);',
    '  const [refreshTick, setRefreshTick] = useState(0);\n  const [teachers, setTeachers] = useState(() => loadTeachers());\n  const [consultOpen, setConsultOpen] = useState(false);'
)

# 3. Delete editingRange
text = re.sub(r'  const editingRange = useMemo\(\(\) => \{.*?  \}, \[editingRecordId, currentCount, baseCount, history, addedCount\]\);\n', '', text, flags=re.DOTALL)

# 4. Fix setPaymentError
text = text.replace(
    'setPaymentError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");',
    'alert("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");'
)

with open("lib/ui/student/StudentHubCore.tsx", "w") as f:
    f.write(text)

print("Fixed collateral damage.")
