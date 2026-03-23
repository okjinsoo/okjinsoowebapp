"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import TeacherEditForm from "@/lib/ui/admin/teachers/TeacherEditForm";
import { useTeacherEditPageData } from "@/lib/ui/admin/teachers/useTeacherEditPageData";

export default function AdminTeacherEditByIdPageClient() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const teacherId = useMemo(() => {
    const raw = params?.id;
    return typeof raw === "string" ? raw : "";
  }, [params]);

  const {
    loaded,
    teacher,
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
  } = useTeacherEditPageData({
    teacherId,
    onSaved: () => {
      router.push("/a/teachers");
    },
  });

  if (!loaded) {
    return (
      <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
        <button className="btn" onClick={() => router.push("/a/teachers")}>
          관리자 페이지
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          선생님 정보 수정
        </div>
        <div style={{ marginTop: 10, color: "var(--text-muted)" }}>불러오는 중...</div>
      </main>
    );
  }

  if (!teacher) {
    return (
      <main style={{ padding: 20, maxWidth: 860, margin: "0 auto" }}>
        <button className="btn" onClick={() => router.push("/a/teachers")}>
          관리자 페이지
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          선생님 정보 수정
        </div>
        <div style={{ marginTop: 10, color: "var(--text-muted)" }}>
          {error || "선생님을 찾지 못했습니다."}
        </div>
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

      <TeacherEditForm
        name={name}
        phone={phone}
        email={email}
        workStartDate={workStartDate}
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
