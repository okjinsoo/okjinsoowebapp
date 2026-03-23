"use client";

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Teacher } from "@/lib/types/index";
import { saveTeachersServerFirst } from "@/lib/storage/teachers";
import { loadLatestCoreSnapshotBaselineServerRequired } from "@/lib/storage/safeSnapshotMerge";
import { makeId, makeToken } from "@/lib/utils/id";
import { nowIso, todayYmdLocal } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";

type UseTeacherNewPageDataArgs = {
  onSaved?: () => void;
};

type UseTeacherNewPageDataResult = {
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

export function useTeacherNewPageData(args: UseTeacherNewPageDataArgs): UseTeacherNewPageDataResult {
  const { onSaved } = args;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [workStartDate, setWorkStartDate] = useState(() => todayYmdLocal());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setError("");

    const nm = name.trim();
    const ph = normalizePhoneDigits(phone);
    const em = email.trim();
    if (!nm) return setError("이름을 입력해주세요.");
    if (!ph) return setError("전화번호를 입력해주세요.");
    if (!em) return setError("이메일을 입력해주세요.");
    if (!workStartDate) return setError("업무 시작일을 입력해주세요.");

    const teacher: Teacher = {
      id: makeId(),
      token: makeToken(12),
      name: nm,
      phone: ph,
      email: em,
      workStartDate,
      createdAt: nowIso(),
      active: true,
    };

    setSaving(true);
    try {
      const baseline = await loadLatestCoreSnapshotBaselineServerRequired();
      await saveTeachersServerFirst([...baseline.teachers, teacher]);
      onSaved?.();
    } catch (err) {
      console.error("선생님 생성 서버 저장 실패:", err);
      setError(SERVER_SAVE_RETRY_MESSAGE);
    } finally {
      setSaving(false);
    }
  }, [email, name, onSaved, phone, workStartDate]);

  return {
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
