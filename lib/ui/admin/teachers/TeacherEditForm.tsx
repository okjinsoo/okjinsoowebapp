"use client";

type TeacherEditFormProps = {
  name: string;
  phone: string;
  email: string;
  workStartDate: string;
  namePlaceholder?: string;
  phonePlaceholder?: string;
  emailPlaceholder?: string;
  error: string;
  saving: boolean;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onWorkStartDateChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

export default function TeacherEditForm(props: TeacherEditFormProps) {
  const {
    name,
    phone,
    email,
    workStartDate,
    namePlaceholder,
    phonePlaceholder,
    emailPlaceholder,
    error,
    saving,
    onNameChange,
    onPhoneChange,
    onEmailChange,
    onWorkStartDateChange,
    onCancel,
    onSave,
  } = props;

  const inputStyle = {
    width: "100%",
    height: 40,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 8,
    marginTop: 6,
  } as const;

  return (
    <>
      <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>이름 *</div>
            <input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={namePlaceholder}
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>전화번호 *</div>
            <input
              value={phone}
              onChange={(e) => onPhoneChange(e.target.value)}
              placeholder={phonePlaceholder}
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>이메일 *</div>
            <input
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              placeholder={emailPlaceholder}
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>업무 시작일 *</div>
            <input type="date" value={workStartDate} onChange={(e) => onWorkStartDateChange(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </section>

      {error ? <div style={{ marginTop: 10, color: "#dc2626" }}>{error}</div> : null}

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={onCancel} disabled={saving}>
          취소
        </button>
        <button className="btn btn-bold" onClick={onSave} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </>
  );
}
