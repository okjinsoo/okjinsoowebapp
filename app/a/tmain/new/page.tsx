// app/a/tmain/new/page.tsx
import { Suspense } from "react";
import TeacherStudentNewPageClient from "@/app/t/tmain/new/TeacherStudentNewPageClient";
import { buildTmainBasePath } from "@/lib/routes/appRouteBuilder";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">로딩 중...</main>}>
      <TeacherStudentNewPageClient basePath={buildTmainBasePath("a")} />
    </Suspense>
  );
}
