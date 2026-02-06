// app/t/tmain/new/page.tsx
import { Suspense } from "react";
import TeacherStudentNewPageClient from "./TeacherStudentNewPageClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">로딩 중...</main>}>
      <TeacherStudentNewPageClient basePath="/t/tmain" />
    </Suspense>
  );
}
