"use client";

import { useCallback, useEffect, useState } from "react";
import type { Student, Teacher } from "@/lib/types/index";
import { saveTeachers, TEACHERS_EVENT } from "@/lib/storage/teachers";
import { saveStudents } from "@/lib/storage/students";
import { isLocalOnlySnapshotMode } from "@/lib/storage/sharedSnapshot";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { loadLatestCoreSnapshotBaselineServerRequired } from "@/lib/storage/safeSnapshotMerge";
import { readTeachersServerFirst } from "@/lib/storage/serverRead";
import {
  SERVER_REFRESH_RETRY_MESSAGE,
  SERVER_SAVE_RETRY_MESSAGE,
} from "@/lib/messages/serverMessages";

type UseTeachersPageDataResult = {
  teachers: Teacher[];
  error: string;
  removeTeacher: (teacherId: string) => Promise<void>;
};

export function useTeachersPageData(): UseTeachersPageDataResult {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const result = await readTeachersServerFirst();
        if (cancelled) return;
        setTeachers(result.teachers);
        if (result.source !== "server" && !isLocalOnlySnapshotMode()) {
          setError(SERVER_REFRESH_RETRY_MESSAGE);
          return;
        }
        setError("");
      } catch {
        if (cancelled) return;
        if (!isLocalOnlySnapshotMode()) {
          setError(SERVER_REFRESH_RETRY_MESSAGE);
          return;
        }
        setError("");
      }
    };

    const id = setTimeout(() => {
      void refresh();
    }, 0);
    const requestRefresh = () => {
      void refresh();
    };
    window.addEventListener(TEACHERS_EVENT, requestRefresh);
    return () => {
      cancelled = true;
      clearTimeout(id);
      window.removeEventListener(TEACHERS_EVENT, requestRefresh);
    };
  }, []);

  const removeTeacher = useCallback(async (teacherId: string) => {
    setError("");
    try {
      const baseline = await loadLatestCoreSnapshotBaselineServerRequired();
      const allTeachers = baseline.teachers;
      const allStudents = baseline.students;
      const assigned = allStudents.filter((s: Student) => (s.teacherId ?? null) === teacherId);

      const msg =
        assigned.length > 0
          ? `정말 삭제할까요?\n\n- 이 선생님에게 배정된 학생 ${assigned.length}명은 자동으로 "미배정" 처리됩니다.`
          : "정말 삭제할까요?";
      if (!confirm(msg)) return;

      const nextStudents =
        assigned.length > 0
          ? allStudents.map((s: Student) => {
            if ((s.teacherId ?? null) !== teacherId) return s;
            return { ...s, teacherId: null };
          })
          : allStudents;
      const nextTeachers = allTeachers.filter((row) => row.id !== teacherId);

      await pushSharedSnapshot({
        teachers: nextTeachers,
        students: nextStudents,
      });
      saveStudents(nextStudents, { skipSharedSnapshot: true });
      saveTeachers(nextTeachers, { skipSharedSnapshot: true });
      setTeachers(nextTeachers);
    } catch (err) {
      console.error("선생님 삭제 서버 저장 실패:", err);
      setError(SERVER_SAVE_RETRY_MESSAGE);
    }
  }, []);

  return {
    teachers,
    error,
    removeTeacher,
  };
}
