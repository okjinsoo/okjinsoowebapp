// v1/lib/ui/student/CurrentTeacherSelectionCard.tsx
"use client";

import type { Teacher } from "@/lib/types/index";

type Role = "a" | "t" | "s";

type Props = {
  role: Role;
  teachers: Teacher[];
  teacherId: string | null;
  title?: string;
  onRoleChange?: (role: Role) => void;
  onTeacherChange?: (teacherId: string) => void;
};

export default function CurrentTeacherSelectionCard({
  role,
  teachers,
  teacherId,
  title = "현재 선택",
  onRoleChange,
  onTeacherChange,
}: Props) {
  const selectStyle = {
    height: 40,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 8,
  };

  const currentTeacherName = teachers.find((t) => t.id === teacherId)?.name ?? "미선택";

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
      <div className="card-title">{title}</div>
      <div style={{ marginTop: 6 }}>
        <span style={{ fontWeight: 700 }}>현재 역할</span> · {role}
        <span style={{ fontWeight: 700, marginLeft: 8 }}>현재 선생님</span> · {currentTeacherName}
      </div>
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "center" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">역할</div>
          <select value={role} onChange={(e) => onRoleChange?.(e.target.value as Role)} style={selectStyle}>
            <option value="a">관리자 (a)</option>
            <option value="t">선생님 (t)</option>
            <option value="s">학생 (s)</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">선생님</div>
          <select
            value={teacherId ?? ""}
            onChange={(e) => onTeacherChange?.(e.target.value)}
            style={selectStyle}
          >
            <option value="">선택하세요</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
