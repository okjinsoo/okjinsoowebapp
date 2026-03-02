import re

with open("lib/ui/student/StudentHubCore.tsx", "r") as f:
    text = f.read()

# 1. State declarations (lines 239-253)
state_re = re.compile(r'  const \[showPaymentPanel, setShowPaymentPanel\] = useState\(false\);\n.*?  const \[refundError, setRefundError\] = useState\(""\);\n', re.DOTALL)
text = state_re.sub('', text)

# 2. refundRecord and editingRange (lines 609-635)
memo_re = re.compile(r'  const refundRecord = useMemo\(\n.*?  }, \[editingRecordId, history, addedCount\]\);\n', re.DOTALL)
text = memo_re.sub('', text)

# 3. closePaymentPanel
close_pay_re = re.compile(r'  function closePaymentPanel\(\) \{.*?    setPaymentError\(""\);\n  }\n', re.DOTALL)
text = close_pay_re.sub('', text)

# 4. openEditPayment
open_edit_re = re.compile(r'  function openEditPayment\(record: PaymentRecord\) \{.*?    setShowPaymentPanel\(true\);\n  }\n', re.DOTALL)
text = open_edit_re.sub('', text)

# 5. closeRefundPanel
close_refund_re = re.compile(r'  function closeRefundPanel\(\) \{.*?    setRefundMode\("request"\);\n  }\n', re.DOTALL)
text = close_refund_re.sub('', text)

# 6. onSubmitRefundRequest through onCancelRefundRequest
submit_refund_re = re.compile(r'  async function onSubmitRefundRequest\(\) \{.*?  async function onCancelRefundRequest\(\) \{.*?    closeRefundPanel\(\);\n  }\n', re.DOTALL)
text = submit_refund_re.sub('', text)

# 7. onApplyPayment and onDeletePaymentRecord
apply_del_re = re.compile(r'  async function onApplyPayment\(\) \{.*?  async function onDeletePaymentRecord\(\) \{.*?    setEditingRecordId\(null\);\n  }\n', re.DOTALL)
text = apply_del_re.sub('', text)

# 8. JSX Block Replacement
# The JSX block is between `      {isAdmin || accessRole === "t" ? (` and `<ConsultModal`
jsx_re = re.compile(r'      \{isAdmin \|\| accessRole === "t" \? \(\n        <section style=\{\{ marginTop: 14, border: "1px solid var\(--surface-border\)".*?(?=      <ConsultModal)', re.DOTALL)

replacement_jsx = """      {isAdmin || accessRole === "t" ? (
        <StudentPaymentPanel
          isAdmin={isAdmin}
          history={history}
          applyHistory={applyHistory}
          student={student}
          baseCount={baseCount}
        />
      ) : null}

"""
text = jsx_re.sub(replacement_jsx, text)

# 9. Imports
# First remove `computeRefundRatio`, `refundRatioLabel`
text = re.sub(r'  computeRefundRatio,\n  refundRatioLabel,\n', '', text)
import_re = re.compile(r'(import ConsultModal, \{ ConsultFormState \} from "@/lib/ui/common/ConsultModal";\n)')
text = import_re.sub(r'\1import { StudentPaymentPanel } from "./panels/StudentPaymentPanel";\n', text)

with open("lib/ui/student/StudentHubCore.tsx", "w") as f:
    f.write(text)

print("Refactored successfully.")
