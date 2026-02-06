// v1/app/a/students/[token]/edit/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { loadTeachers } from "@/lib/storage/teachers";
import StudentEditClient from "@/lib/ui/student/StudentEditClient";
import type { Teacher } from "@/lib/types/index";

export default function AdminStudentEditPage() {
  const params = useParams();
  const token = String(params?.token ?? "");
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    const id = setTimeout(() => setTeachers(loadTeachers()), 0);
    return () => clearTimeout(id);
  }, []);

  return (
    <StudentEditClient mode="admin" teachers={teachers} token={token} onDoneGoTo={`/a/smain`} />
  );
}
