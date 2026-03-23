// v1/app/a/students/new/page.tsx
"use client";

import { useTeachersServerFirst } from "@/lib/hooks/useTeachersServerFirst";
import StudentNewClient from "@/lib/ui/student/StudentNewClient";

export default function AdminStudentNewPage() {
  const { teachers } = useTeachersServerFirst();

  return <StudentNewClient mode="admin" teachers={teachers} onDoneGoTo="/a/students" />;
}
