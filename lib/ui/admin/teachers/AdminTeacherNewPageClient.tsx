"use client";

import { useRouter } from "next/navigation";
import TeacherEditForm from "@/lib/ui/admin/teachers/TeacherEditForm";
import { useTeacherNewPageData } from "@/lib/ui/admin/teachers/useTeacherNewPageData";

export default function AdminTeacherNewPageClient() {
  const router = useRouter();
  const {
    name,
    setName,
    phone,
    setPhone,
    email,
    setEmail,
    workStartDate,
    setWorkStartDate,
    error,
    saving,
    save,
  } = useTeacherNewPageData({
    onSaved: () => {
      router.push("/a/teachers");
    },
  });

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

      <TeacherEditForm
        name={name}
        phone={phone}
        email={email}
        workStartDate={workStartDate}
        namePlaceholder="예: 홍길동"
        phonePlaceholder="예: 010-1234-5678"
        emailPlaceholder="예: teacher@okjinsoo.com"
        error={error}
        saving={saving}
        onNameChange={setName}
        onPhoneChange={setPhone}
        onEmailChange={setEmail}
        onWorkStartDateChange={setWorkStartDate}
        onCancel={() => router.push("/a/teachers")}
        onSave={() => void save()}
      />
    </main>
  );
}
