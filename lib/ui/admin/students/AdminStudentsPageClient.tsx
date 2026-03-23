"use client";

import { useRouter } from "next/navigation";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";
import StudentListSection from "@/lib/ui/admin/students/StudentListSection";
import type { AdminStudentCard } from "@/lib/ui/admin/students/useAdminStudentsPageData";
import { useAdminStudentsPageData } from "@/lib/ui/admin/students/useAdminStudentsPageData";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";

export default function AdminStudentsPageClient() {
  const router = useRouter();
  const { activeCards, pausedCards } = useAdminStudentsPageData();

  const openStudentMain = (card: AdminStudentCard) => {
    if (card.teacherId) saveCurrentTeacherId(card.teacherId);
    saveCurrentStudentToken(card.token);
    router.push("/a/smain");
  };

  const openStudentEdit = (card: AdminStudentCard) => {
    if (card.teacherId) saveCurrentTeacherId(card.teacherId);
    saveCurrentStudentToken(card.token);
    router.push("/a/smain/edit");
  };

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => router.push("/a/amain")}>
          관리자 페이지
        </button>
      </div>

      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">학생 관리 (원장)</h1>
        <div>
          <button onClick={() => router.push("/a/students/new")} style={{ padding: "8px 12px", fontWeight: 800 }}>
            + 학생 추가
          </button>
        </div>
      </section>

      <StudentListSection
        title="재학생 리스트"
        cards={activeCards}
        onOpenStudentMain={openStudentMain}
        onOpenStudentEdit={openStudentEdit}
      />

      <StudentListSection
        title="휴회생 리스트"
        cards={pausedCards}
        onOpenStudentMain={openStudentMain}
        onOpenStudentEdit={openStudentEdit}
      />
    </main>
  );
}
