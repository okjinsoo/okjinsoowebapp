// lib/ui/common/RoleGateCard.tsx
"use client";

import type { Student, Teacher } from "@/lib/types/index";
import { usePathname, useSearchParams } from "next/navigation";
import { saveCurrentRole, saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";
import { dispatchGateUpdated } from "@/lib/ui/common/roleGateStorage";

type Role = "a" | "t" | "s";

type Props = {
  role: Role;
  teachers: Teacher[];
  students: Student[];
  teacherId: string | null;
  studentToken: string | null;
  title?: string;
  onTeacherChange?: (teacherId: string) => void;
  onStudentChange?: (token: string) => void;
};

function replaceRolePath(pathname: string, role: Role) {
  const parts = pathname.split("/").filter(Boolean);
  const roles = new Set(["a", "t", "s"]);
  if (parts.length === 0) return `/${role}`;
  if (roles.has(parts[0])) parts[0] = role;
  else parts.unshift(role);

  const nextPath = `/${parts.join("/")}`;
  if (nextPath.includes("/tmain") && role === "s") return "/s/smain";
  if (nextPath.includes("/amain") && role !== "a") return `/${role}/smain`;
  return nextPath;
}

export default function RoleGateCard({
  role,
  teachers,
  students,
  teacherId,
  studentToken,
  title = "현재 선택",
  onTeacherChange,
  onStudentChange,
}: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selectStyle = {
    height: 40,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 8,
  };

  const currentTeacherName = teachers.find((t) => t.id === teacherId)?.name ?? "미선택";
  const currentStudentName = students.find((s) => s.token === studentToken)?.name ?? "미선택";

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
      <div className="card-title">{title}</div>
      <div style={{ marginTop: 6 }}>
        <span style={{ fontWeight: 700 }}>현재 역할</span> · {role}
        <span style={{ fontWeight: 700, marginLeft: 8 }}>현재 선생님</span> · {currentTeacherName}
        <span style={{ fontWeight: 700, marginLeft: 8 }}>현재 학생</span> · {currentStudentName}
      </div>
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, alignItems: "center" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">역할</div>
          <select
            value={role}
            onChange={(e) => {
              const next = e.target.value as Role;
              saveCurrentRole(next);
              const nextPath = replaceRolePath(pathname || "/", next);
              const q = searchParams?.toString();
              window.location.href = q ? `${nextPath}?${q}` : nextPath;
            }}
            style={selectStyle}
          >
            <option value="a">관리자 (a)</option>
            <option value="t">선생님 (t)</option>
            <option value="s">학생 (s)</option>
          </select>
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">선생님</div>
          <select
            value={teacherId ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              saveCurrentTeacherId(next);
              onTeacherChange?.(next);
              dispatchGateUpdated();
            }}
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
        <div style={{ display: "grid", gap: 6 }}>
          <div className="text-muted">학생</div>
          <select
            value={studentToken ?? ""}
            onChange={(e) => {
              const next = e.target.value;
              saveCurrentStudentToken(next);
              onStudentChange?.(next);
              dispatchGateUpdated();
            }}
            style={selectStyle}
          >
            <option value="">선택하세요</option>
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
