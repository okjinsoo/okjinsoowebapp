"use client";

import { useParams } from "next/navigation";
import { useTeachersServerFirst } from "@/lib/hooks/useTeachersServerFirst";
import StudentEditClient from "@/lib/ui/student/StudentEditClient";

type StudentEditTokenPageClientProps = {
  mode: "admin" | "teacher";
  onDoneGoTo: string;
};

export default function StudentEditTokenPageClient(props: StudentEditTokenPageClientProps) {
  const { mode, onDoneGoTo } = props;
  const params = useParams();
  const tokenParam = params?.token;
  const token = Array.isArray(tokenParam)
    ? String(tokenParam[0] ?? "")
    : String(tokenParam ?? "");
  const { teachers } = useTeachersServerFirst();

  return (
    <StudentEditClient
      mode={mode}
      teachers={teachers}
      token={token}
      onDoneGoTo={onDoneGoTo}
    />
  );
}
