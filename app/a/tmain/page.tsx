// app/a/tmain/page.tsx
import { Suspense } from "react";
import TeacherMainClient from "@/app/t/tmain/TeacherMainClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">로딩 중...</main>}>
      <TeacherMainClient initialRole="a" />
    </Suspense>
  );
}
