"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Teacher } from "@/lib/types/index";
import {
  findTeacherById,
  loadCurrentTeacherId,
  loadTeachers,
  saveTeachersServerFirst,
} from "@/lib/storage/teachers";
import { loadLatestCoreSnapshotBaseline } from "@/lib/storage/safeSnapshotMerge";
import { todayYmdLocal } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";

export default function AdminTeacherEditPage() {
  const router = useRouter();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [workStartDate, setWorkStartDate] = useState(() => todayYmdLocal());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      const id = loadCurrentTeacherId();
      if (!id) return;
      const t = findTeacherById(id);
      setTeacher(t);
      if (!t) return;
      setName(t.name ?? "");
      setPhone(t.phone ?? "");
      setEmail(t.email ?? "");
      setWorkStartDate(t.workStartDate ?? todayYmdLocal());
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function onSave() {
    if (!teacher) return;
    setError("");
    const nm = name.trim();
    const ph = normalizePhoneDigits(phone);
    const em = email.trim();
    if (!nm) return setError("이름을 입력해주세요.");
    if (!ph) return setError("전화번호를 입력해주세요.");
    if (!em) return setError("이메일을 입력해주세요.");
    if (!workStartDate) return setError("업무 시작일을 입력해주세요.");

    const nextTeacher: Teacher = {
      ...teacher,
      name: nm,
      phone: ph,
      email: em,
      workStartDate,
    };

    setSaving(true);
    try {
      const baseline = await loadLatestCoreSnapshotBaseline();
      const baseTeachers = baseline.teachers.length > 0 ? baseline.teachers : loadTeachers();
      let found = false;
      const nextTeachers = baseTeachers.map((row) => {
        if (row.id !== teacher.id) return row;
        found = true;
        return nextTeacher;
      });
      if (!found) {
        setError("수정 대상 선생님을 최신 목록에서 찾지 못했습니다. 목록에서 다시 선택해주세요.");
        return;
      }
      await saveTeachersServerFirst(nextTeachers);
      router.push("/a/teachers");
    } catch (err) {
      console.error("선생님 수정 서버 저장 실패:", err);
      setError("서버 저장에 실패했어요. 잠시 뒤 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = {
    width: "100%",
    height: 40,
    padding: 10,
    border: "1px solid #ccc",
    borderRadius: 8,
    marginTop: 6,
  } as const;

  if (!teacher) {
    return (
      <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
        <button className="btn" onClick={() => router.push("/a/teachers")}>
          관리자 페이지
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          선생님 정보 수정
        </div>
        <div style={{ marginTop: 10, color: "var(--text-muted)" }}>선생님을 찾지 못했습니다.</div>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <div>
        <button className="btn" onClick={() => router.push("/a/teachers")}>
          관리자 페이지
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          선생님 정보 수정
        </div>
      </div>

      <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>이름 *</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>전화번호 *</div>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>이메일 *</div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>업무 시작일 *</div>
            <input type="date" value={workStartDate} onChange={(e) => setWorkStartDate(e.target.value)} style={inputStyle} />
          </div>
        </div>
      </section>

      {error ? <div style={{ marginTop: 10, color: "#dc2626" }}>{error}</div> : null}

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn" onClick={() => router.push("/a/teachers")} disabled={saving}>
          취소
        </button>
        <button className="btn btn-bold" onClick={() => void onSave()} disabled={saving}>
          {saving ? "저장 중..." : "저장"}
        </button>
      </div>
    </main>
  );
}
