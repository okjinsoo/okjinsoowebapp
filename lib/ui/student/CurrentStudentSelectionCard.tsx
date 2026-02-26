// v1/lib/ui/student/CurrentStudentSelectionCard.tsx
"use client";

import type { Student } from "@/lib/types/index";

type Role = "a" | "t" | "s";

type Props = {
  role: Role;
  students: Student[];
  token: string;
  title?: string;
  onRoleChange?: (role: Role) => void;
  onStudentChange?: (token: string) => void;
  roleSelectDisabled?: boolean;
  studentSelectDisabled?: boolean;
};

export default function CurrentStudentSelectionCard({
  role,
  students,
  token,
  title = "현재 선택",
  onRoleChange,
  onStudentChange,
  roleSelectDisabled = false,
  studentSelectDisabled = false,
}: Props) {
  const selectStyle = {
    height: 40,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 8,
  };

  const currentStudent = students.find((s) => s.token === token);

  return (
    <div style={{ border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
      <div className="card-title">{title}</div>
      <div style={{ marginTop: 6 }}>
        <span style={{ fontWeight: 700 }}>현재 역할</span> · {role}
        <span style={{ fontWeight: 700, marginLeft: 8 }}>현재 학생</span> · {currentStudent?.name ?? "알 수 없음"} ({token})
      </div>
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "center" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">역할</div>
          <select
            value={role}
            onChange={(e) => onRoleChange?.(e.target.value as Role)}
            style={selectStyle}
            disabled={roleSelectDisabled}
          >
            <option value="a">관리자 (a)</option>
            <option value="t">선생님 (t)</option>
            <option value="s">학생 (s)</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">학생</div>
          <select
            value={token}
            onChange={(e) => onStudentChange?.(e.target.value)}
            style={selectStyle}
            disabled={studentSelectDisabled}
          >
            {students.map((s) => (
              <option key={s.id} value={s.token}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
