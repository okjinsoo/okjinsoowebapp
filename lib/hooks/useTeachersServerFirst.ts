"use client";

import { useEffect, useState } from "react";
import { readTeachersServerFirst } from "@/lib/storage/serverRead";
import { TEACHERS_EVENT } from "@/lib/storage/teachers";
import type { Teacher } from "@/lib/types/index";

type UseTeachersServerFirstResult = {
  teachers: Teacher[];
  loaded: boolean;
};

export function useTeachersServerFirst(): UseTeachersServerFirstResult {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const refreshTeachers = async () => {
      const next = await readTeachersServerFirst();
      if (cancelled) return;
      setTeachers(next.teachers);
      setLoaded(true);
    };

    const requestRefresh = () => {
      void refreshTeachers();
    };
    const requestRefreshFromStorage: EventListener = (event) => {
      const storageEvent = event as StorageEvent;
      if (storageEvent.key && storageEvent.key !== "tutorweb_teachers_v1") return;
      void refreshTeachers();
    };

    void refreshTeachers();
    window.addEventListener(TEACHERS_EVENT, requestRefresh);
    window.addEventListener("storage", requestRefreshFromStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(TEACHERS_EVENT, requestRefresh);
      window.removeEventListener("storage", requestRefreshFromStorage);
    };
  }, []);

  return {
    teachers,
    loaded,
  };
}
