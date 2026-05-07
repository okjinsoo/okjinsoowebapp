import { Suspense } from "react";
import TeacherMainClient from "@/app/t/tmain/TeacherMainClient";

export default async function AdminTeacherMainPage({
  params,
}: {
  params: Promise<{ teacherToken: string }>;
}) {
  const { teacherToken } = await params;
  return (
    <Suspense fallback={<main className="p-6">로딩 중...</main>}>
      <TeacherMainClient
        initialRole="a"
        adminPathMode="teacherScoped"
        adminTeacherToken={teacherToken}
      />
    </Suspense>
  );
}
