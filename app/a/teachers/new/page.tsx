"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Teacher } from "@/lib/types/index";
import { loadTeachers, saveTeachersServerFirst } from "@/lib/storage/teachers";
import { pullSharedSnapshotAndHydrateWithOptions } from "@/lib/storage/sharedSnapshot";
import { makeId, makeToken } from "@/lib/utils/id";
import { nowIso, todayYmdLocal } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";

export default function AdminTeacherNewPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [workStartDate, setWorkStartDate] = useState(() => todayYmdLocal());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setError("");
    const nm = name.trim();
    const ph = normalizePhoneDigits(phone);
    const em = email.trim();

    if (!nm) return setError("이름을 입력해주세요.");
    if (!ph) return setError("전화번호를 입력해주세요.");
    if (!em) return setError("이메일을 입력해주세요.");
    if (!workStartDate) return setError("업무 시작일을 입력해주세요.");

    const teacher: Teacher = {
      id: makeId(),
      token: makeToken(12),
      name: nm,
      phone: ph,
      email: em,
      workStartDate,
      createdAt: nowIso(),
      active: true,
    };

    setSaving(true);
    try {
      const remote = await pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true });
      const baseTeachers = remote?.teachers ?? loadTeachers();
      await saveTeachersServerFirst([...baseTeachers, teacher]);
      router.push("/a/teachers");
    } catch (err) {
      console.error("선생님 생성 서버 저장 실패:", err);
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

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
      <div>
        <button className="btn" onClick={() => router.push("/a/teachers")}>
          돌아가기
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          선생님 추가
        </div>
      </div>

      <section style={{ marginTop: 14, border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700 }}>이름 *</div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 홍길동" style={inputStyle} />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>전화번호 *</div>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="예: 010-1234-5678"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={{ fontWeight: 700 }}>이메일 *</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="예: teacher@okjinsoo.com"
              style={inputStyle}
            />
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
