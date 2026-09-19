import { Suspense } from "react";
import TeacherMainClient from "./TeacherMainClient";
import { TeacherMainSkeleton } from "@/lib/ui/common/AppSkeleton";

export default function Page() {
  return (
    <Suspense fallback={<TeacherMainSkeleton />}>
      <TeacherMainClient />
    </Suspense>
  );
}
