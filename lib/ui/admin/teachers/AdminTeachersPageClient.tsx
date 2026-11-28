"use client";

import PageHeader from "@/lib/ui/common/PageHeader";
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
    <main className="page">
      <PageHeader
        title="선생님 관리"
        actions={
          <button className="btn btn-black" onClick={() => router.push("/a/teachers/new")}>
            + 선생님 추가
          </button>
        }
      />

      {error ? (
        <div style={{ marginTop: 12, color: "var(--alert-strong)", fontWeight: 700 }}>{error}</div>
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
