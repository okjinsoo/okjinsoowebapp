// v1/app/a/students/new/page.tsx
"use client";

import React, { useEffect, useState } from "react";
import { hydrateTeachersFromServer } from "@/lib/storage/teachers";
import type { Teacher } from "@/lib/types/index";
import StudentNewClient from "@/lib/ui/student/StudentNewClient";

export default function AdminStudentNewPage() {
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      void hydrateTeachersFromServer().then((nextTeachers) => setTeachers(nextTeachers));
    }, 0);
    return () => clearTimeout(id);
  }, []);

  return <StudentNewClient mode="admin" teachers={teachers} onDoneGoTo="/a/students" />;
}
