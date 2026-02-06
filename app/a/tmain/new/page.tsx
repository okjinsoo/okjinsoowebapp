// app/a/tmain/new/page.tsx
import { Suspense } from "react";
import TeacherStudentNewPageClient from "@/app/t/tmain/new/TeacherStudentNewPageClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">로딩 중...</main>}>
      <TeacherStudentNewPageClient basePath="/a/tmain" />
    </Suspense>
  );
}
