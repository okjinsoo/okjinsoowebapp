"use client";

import { useRouter } from "next/navigation";
import type { Teacher } from "@/lib/types/index";
import TeacherListSection from "@/lib/ui/admin/teachers/TeacherListSection";
import { useTeachersPageData } from "@/lib/ui/admin/teachers/useTeachersPageData";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";

export default function AdminTeachersPageClient() {
  const router = useRouter();
  const { teachers, error, removeTeacher } = useTeachersPageData();

  const handleOpenTeacherView = (teacher: Teacher) => {
    const token = (teacher.token ?? "").trim();
    if (!token) {
      router.push("/a/tmain");
      return;
    }
    router.push(`/a/tmain/${encodeURIComponent(token)}`);
  };

  const handleEditTeacher = (teacher: Teacher) => {
    router.push(`/a/teachers/${teacher.id}/edit`);
  };

  const handleRemoveTeacher = (teacher: Teacher) => {
    void removeTeacher(teacher.id).catch((err) => {
      console.error("선생님 삭제 서버 저장 실패:", err);
      alert(SERVER_SAVE_RETRY_MESSAGE);
    });
  };

  return (
    <main style={{ padding: 20, maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => router.push("/a/amain")}>
          관리자 페이지
        </button>
      </div>

      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">선생님 관리 (원장)</h1>
        <div>
          <button className="btn btn-bold" onClick={() => router.push("/a/teachers/new")}>
            + 선생님 추가
          </button>
        </div>
      </section>

      {error ? (
        <div style={{ marginTop: 12, color: "#b42318", fontWeight: 700 }}>{error}</div>
      ) : null}

      <TeacherListSection
        teachers={teachers}
        onOpenTeacherView={handleOpenTeacherView}
        onEditTeacher={handleEditTeacher}
        onRemoveTeacher={handleRemoveTeacher}
      />
    </main>
  );
}
