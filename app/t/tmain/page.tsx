// app/t/tmain/page.tsx
import { Suspense } from "react";
import TeacherMainClient from "./TeacherMainClient";

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6">로딩 중...</main>}>
      <TeacherMainClient />
    </Suspense>
  );
}
