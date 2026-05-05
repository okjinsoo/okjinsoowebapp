"use client";

import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Teacher } from "@/lib/types/index";
import { isLocalOnlySnapshotMode } from "@/lib/storage/sharedSnapshot";
import { saveTeachersServerFirst } from "@/lib/storage/teachers";
import { loadLatestCoreSnapshotBaselineServerRequired } from "@/lib/storage/safeSnapshotMerge";
import { readTeachersServerFirst } from "@/lib/storage/serverRead";
import { todayYmdLocal } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";
import {
  SERVER_LOAD_RETRY_MESSAGE,
  SERVER_SAVE_RETRY_MESSAGE,
} from "@/lib/messages/serverMessages";

type UseTeacherEditPageDataArgs = {
  teacherId: string;
  onSaved?: () => void;
};

type UseTeacherEditPageDataResult = {
  loaded: boolean;
  teacher: Teacher | null;
  name: string;
  setName: Dispatch<SetStateAction<string>>;
  phone: string;
  setPhone: Dispatch<SetStateAction<string>>;
  email: string;
  setEmail: Dispatch<SetStateAction<string>>;
  workStartDate: string;
  setWorkStartDate: Dispatch<SetStateAction<string>>;
  error: string;
  saving: boolean;
  save: () => Promise<void>;
};

export function useTeacherEditPageData(args: UseTeacherEditPageDataArgs): UseTeacherEditPageDataResult {
  const { teacherId, onSaved } = args;

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [workStartDate, setWorkStartDate] = useState(() => todayYmdLocal());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (!teacherId) {
          if (!cancelled) setLoaded(true);
          return;
        }
        try {
          const result = await readTeachersServerFirst();
          if (cancelled) return;
          const found = result.teachers.find((row) => row.id === teacherId) ?? null;
          setTeacher(found);
          if (found) {
            setName(found.name ?? "");
            setPhone(found.phone ?? "");
            setEmail(found.email ?? "");
            setWorkStartDate(found.workStartDate ?? todayYmdLocal());
          }
          if (result.source !== "server" && !isLocalOnlySnapshotMode()) {
            setError(SERVER_LOAD_RETRY_MESSAGE);
          } else {
            setError("");
          }
        } catch {
          if (cancelled) return;
          if (!isLocalOnlySnapshotMode()) {
            setError(SERVER_LOAD_RETRY_MESSAGE);
          } else {
            setError("");
          }
        }
        setLoaded(true);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [teacherId]);

  const save = useCallback(async () => {
    if (!teacher || !teacherId) return;
    setError("");

    const nm = name.trim();
    const ph = normalizePhoneDigits(phone);
    const em = email.trim();
    if (!nm) return setError("이름을 입력해주세요.");
    if (!ph) return setError("전화번호를 입력해주세요.");
    if (!em) return setError("이메일을 입력해주세요.");
    if (!workStartDate) return setError("업무 시작일을 입력해주세요.");

    const nextTeacher: Teacher = {
      ...teacher,
      name: nm,
      phone: ph,
      email: em,
      workStartDate,
    };

    setSaving(true);
    try {
      const baseline = await loadLatestCoreSnapshotBaselineServerRequired();
      let found = false;
      const nextTeachers = baseline.teachers.map((row) => {
        if (row.id !== teacherId) return row;
        found = true;
        return nextTeacher;
      });
      if (!found) {
        setError("수정 대상 선생님을 최신 목록에서 찾지 못했습니다. 목록에서 다시 선택해주세요.");
        return;
      }
      await saveTeachersServerFirst(nextTeachers);
      onSaved?.();
    } catch (err) {
      console.error("선생님 수정 서버 저장 실패:", err);
      setError(SERVER_SAVE_RETRY_MESSAGE);
    } finally {
      setSaving(false);
    }
  }, [email, name, onSaved, phone, teacher, teacherId, workStartDate]);

  return {
    loaded,
    teacher,
    name,
    setName,
    phone,
    setPhone,
    email,
    setEmail,
    workStartDate,
    setWorkStartDate,
    error,
    saving,
    save,
  };
}
