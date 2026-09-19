import { Suspense } from "react";
import TeacherMainClient from "@/app/t/tmain/TeacherMainClient";
import { TeacherMainSkeleton } from "@/lib/ui/common/AppSkeleton";

export default function Page() {
  return (
    <Suspense fallback={<TeacherMainSkeleton />}>
      <TeacherMainClient initialRole="a" />
    </Suspense>
  );
}
