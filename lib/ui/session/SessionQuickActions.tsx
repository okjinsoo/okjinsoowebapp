// lib/ui/session/SessionQuickActions.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { browserStorage } from "@/lib/storage/browserStorage";
import { loadStudents } from "@/lib/storage/students";
import { loadCurrentTeacherId } from "@/lib/storage/teachers";
import { sessionsByStudent } from "@/lib/storage/sessions";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  metaMapKey,
  upsertMeta,
  useMetaMap,
  readMetaMap,
} from "@/lib/factories/sessionFactories";

type Props = {
  role: "a" | "t" | "s";
  token: string;
  index: number;
};

function isNonNegInt(n: unknown): boolean {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) && Math.floor(x) === x && x >= 0;
}

function ymdTodayLocal(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function SessionQuickActions({ role, token, index }: Props) {
  const canEdit = role === "a" || role === "t";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [students, setStudents] = useState(() => loadStudents());
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setStudents(loadStudents());
      setTeacherId(loadCurrentTeacherId());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onStudents = () => setStudents(loadStudents());
    window.addEventListener("tutorweb:studentsUpdated", onStudents);
    return () => window.removeEventListener("tutorweb:studentsUpdated", onStudents);
  }, []);

  const metaMap = useMetaMap(token);
  const hydratedMetaMap = useMemo(() => (mounted ? metaMap : {}), [mounted, metaMap]);
  const baseDatesISO = useMemo(() => buildBaseDatesISOByToken(token, 60), [token]);

  const { meta } = useMemo(() => {
    return computeEffectiveISO({
      token,
      index,
      baseDatesISO,
      metaMap: hydratedMetaMap,
    });
  }, [token, index, baseDatesISO, hydratedMetaMap]);

  const isPresent = meta.status === "present";
  const isAbsent = meta.status === "absent";

  const [open, setOpen] = useState(false);
  const [openMode, setOpenMode] = useState<"edit" | "absent">("edit");

  const [checkPresent, setCheckPresent] = useState(false);
  const [checkAbsent, setCheckAbsent] = useState(false);
  const [checkOverride, setCheckOverride] = useState(false);
  const [checkCarry, setCheckCarry] = useState(false);

  const [draftCarry, setDraftCarry] = useState<number>(0);
  const [draftOverrideDate, setDraftOverrideDate] = useState<string>("");
  const [draftOverrideHour, setDraftOverrideHour] = useState<number | null>(null);
  const [draftOverrideMinute, setDraftOverrideMinute] = useState<0 | 30 | null>(null);
  const [draftReason, setDraftReason] = useState<string>("");
  const [draftRecord, setDraftRecord] = useState<string>("");

  const syncSnapshotNow = () => {
    const key = metaMapKey(token);
    const value = browserStorage.getItem(key);
    if (typeof value !== "string") return;
    void pushSharedSnapshot({ stateKv: { [key]: value } }).catch((err) => {
      console.error("공유 스냅샷 즉시 동기화 실패(quick actions):", err);
    });
  };

  const togglePresent = () => {
    if (!canEdit) return;
    upsertMeta(token, index, { status: isPresent ? "planned" : "present" });
    syncSnapshotNow();
  };

  const toggleAbsent = () => {
    if (!canEdit) return;
    if (isAbsent) {
      upsertMeta(token, index, { status: "planned" });
      syncSnapshotNow();
      return;
    }
    setOpenMode("absent");
    setOpen(true);
  };

  const openAdjustModal = () => {
    if (!canEdit) return;
    setOpenMode("edit");
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;

    setCheckPresent(meta.status === "present");
    setCheckAbsent(meta.status === "absent");

    const hasOverride = Boolean(meta.overrideDate);
    setCheckOverride(hasOverride);
    setDraftOverrideDate(meta.overrideDate ?? "");

    const hh = meta.overrideHour ?? null;
    const mm = meta.overrideMinute ?? null;
    setDraftOverrideHour(typeof hh === "number" ? hh : null);
    setDraftOverrideMinute(mm === 0 || mm === 30 ? (mm as 0 | 30) : null);

    const carryVal = meta.carry ?? 0;
    const hasCarry = Number(carryVal) > 0;
    setCheckCarry(hasCarry);
    setDraftCarry(typeof carryVal === "number" ? carryVal : 0);

    setDraftReason(meta.reason ?? "");
    setDraftRecord(meta.record ?? "");

    if (openMode === "absent") {
      setCheckAbsent(true);
      setCheckPresent(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const clickPresent = () => {
    setCheckPresent((prev) => {
      const next = !prev;
      if (next) setCheckAbsent(false);
      return next;
    });
  };

  const clickAbsent = () => {
    setCheckAbsent((prev) => {
      const next = !prev;
      if (next) setCheckPresent(false);
      return next;
    });
  };

  const toggleOverride = (next: boolean) => {
    setCheckOverride(next);
    if (!next) {
      setDraftOverrideDate("");
      setDraftOverrideHour(null);
      setDraftOverrideMinute(null);
      return;
    }
    setDraftOverrideDate((prev) => (prev ? prev : ymdTodayLocal()));
    setDraftOverrideHour(null);
    setDraftOverrideMinute(null);
  };

  const toggleCarry = (next: boolean) => {
    setCheckCarry(next);
    if (!next) setDraftCarry(0);
  };

  function kstYmdFromISO(iso: string): string | null {
    try {
      const dt = new Date(iso);
      if (!Number.isFinite(dt.getTime())) return null;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(dt);
      const y = parts.find((p) => p.type === "year")?.value ?? "1970";
      const m = parts.find((p) => p.type === "month")?.value ?? "01";
      const d = parts.find((p) => p.type === "day")?.value ?? "01";
      return `${y}-${m}-${d}`;
    } catch {
      return null;
    }
  }

  function kstTimeFromISO(iso: string): string | null {
    try {
      const dt = new Date(iso);
      if (!Number.isFinite(dt.getTime())) return null;
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(dt);
      const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
      const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
      return `${hh}시 ${mm}분`;
    } catch {
      return null;
    }
  }

  function formatYmdKor(ymd: string) {
    const [, m, d] = ymd.split("-");
    const mm = String(Number(m ?? "0"));
    const dd = String(Number(d ?? "0"));
    return `${mm}월 ${dd}일`;
  }

  const teacherDateTimes = useMemo(() => {
    if (!canEdit || !draftOverrideDate) return [];
    if (!teacherId) return [];
    const owned = students.filter((s) => (s.teacherId ?? null) === teacherId && s.token);
    const times: Array<{ time: string; name: string }> = [];

    for (const st of owned) {
      const baseDatesISO = buildBaseDatesISOByToken(st.token, 60);
      const metaMap = readMetaMap(st.token);
      const sessions = sessionsByStudent(st.id);
      for (const s of sessions) {
        const { effectiveISO } = computeEffectiveISO({
          token: st.token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });
        if (!effectiveISO) continue;
        const ymd = kstYmdFromISO(effectiveISO);
        if (ymd !== draftOverrideDate) continue;
        const t = kstTimeFromISO(effectiveISO);
        if (t) times.push({ time: t, name: st.name });
      }
    }

    return times.sort((a, b) => {
      const timeCmp = a.time.localeCompare(b.time, "ko");
      if (timeCmp !== 0) return timeCmp;
      return a.name.localeCompare(b.name, "ko");
    });
  }, [canEdit, draftOverrideDate, teacherId, students]);

  const resetOverrideOnly = () => {
    setCheckOverride(false);
    setDraftOverrideDate("");
    setDraftOverrideHour(null);
    setDraftOverrideMinute(null);
  };

  const resetCarryOnly = () => {
    setCheckCarry(false);
    setDraftCarry(0);
  };

  const needReasonUI = checkAbsent || checkOverride || checkCarry;

  function canSave(): { ok: boolean; msg?: string } {
    if (checkOverride) {
      if (!draftOverrideDate) {
        return { ok: false, msg: "변경을 체크했다면 ‘수업 변경일’을 입력해야 합니다." };
      }
      if (draftOverrideHour === null || draftOverrideMinute === null) {
        return {
          ok: false,
          msg: "변경을 체크했다면 ‘수업 변경 시간’을 선택해야 합니다. (00/30분만 가능)",
        };
      }
    }

    if (checkCarry) {
      if (!isNonNegInt(draftCarry)) {
        return { ok: false, msg: "이월된 수업 횟수는 0 이상의 정수여야 합니다." };
      }
    }

    if (needReasonUI) {
      if (!draftReason.trim()) {
        return { ok: false, msg: "사유를 입력해야 저장할 수 있습니다." };
      }
    }

    return { ok: true };
  }

  const onCancel = () => setOpen(false);

  const onSave = () => {
    const chk = canSave();
    if (!chk.ok) {
      alert(chk.msg ?? "입력값을 확인해주세요.");
      return;
    }

    const status = checkAbsent ? "absent" : checkPresent ? "present" : "planned";

    const h = checkOverride ? (draftOverrideHour ?? 0) : 0;
    const m = checkOverride ? (draftOverrideMinute ?? 0) : 0;

    upsertMeta(token, index, {
      status,
      carry: checkCarry ? Number(draftCarry) : 0,
      overrideDate: checkOverride ? draftOverrideDate : "",
      overrideHour: checkOverride ? h : null,
      overrideMinute: checkOverride ? m : null,
      reason: needReasonUI ? draftReason : "",
      record: needReasonUI ? draftRecord : "",
    });
    syncSnapshotNow();

    setOpen(false);
  };

  if (!canEdit) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <button className={`${isPresent ? "btn btn-blue" : "btn btn-white"}`} onClick={togglePresent}>
          출석
        </button>

        <button className={`${isAbsent ? "btn btn-red" : "btn btn-white"}`} onClick={toggleAbsent}>
          결석
        </button>

        <button className="btn btn-white btn-bold" onClick={openAdjustModal}>
          조정
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded bg-white p-4 shadow">
            <div className="card-title">회차 조정</div>

            <div className="mt-3 grid gap-4">
              <div className="grid gap-2">
                <div className="text-sm font-semibold">출결</div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clickPresent}
                    className={`rounded border ${checkPresent ? "btn btn-blue" : "btn btn-white"}`}
                  >
                    출석
                  </button>

                  <button
                    type="button"
                    onClick={clickAbsent}
                    className={`rounded border ${checkAbsent ? "btn btn-red" : "btn btn-white"}`}
                  >
                    결석
                  </button>
                </div>

                <div className="text-xs text-neutral-500">• 같은 버튼을 한 번 더 누르면 해제됩니다.</div>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={checkOverride}
                      onChange={(e) => toggleOverride(e.target.checked)}
                    />
                    <span>변경</span>
                  </label>

                  {checkOverride && (
                    <button
                      type="button"
                      className="rounded border border-neutral-300 px-2 py-1 text-xs"
                      onClick={resetOverrideOnly}
                    >
                      초기화
                    </button>
                  )}
                </div>

                {checkOverride && (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-sm font-semibold">수업 변경일</div>
                      <div className="text-sm font-semibold">수업 변경 시간</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="rounded border border-neutral-300 px-2 py-1"
                        type="date"
                        value={draftOverrideDate}
                        onChange={(e) => setDraftOverrideDate(e.target.value)}
                      />

                      <div className="flex items-center gap-2">
                        <select
                          className="rounded border border-neutral-300 px-2 py-1"
                          value={draftOverrideHour === null ? "" : draftOverrideHour}
                          onChange={(e) => {
                            const v = e.target.value;
                            setDraftOverrideHour(v === "" ? null : Number(v));
                          }}
                        >
                          <option value="">시 선택</option>
                          {Array.from({ length: 24 }, (_, h) => (
                            <option key={h} value={h}>
                              {String(h).padStart(2, "0")}
                            </option>
                          ))}
                        </select>

                        <span className="text-sm text-neutral-600">:</span>

                        <select
                          className="rounded border border-neutral-300 px-2 py-1"
                          value={draftOverrideMinute === null ? "" : draftOverrideMinute}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "") {
                              setDraftOverrideMinute(null);
                              return;
                            }
                            setDraftOverrideMinute(Number(v) === 30 ? 30 : 0);
                          }}
                        >
                          <option value="">분 선택</option>
                          <option value={0}>00</option>
                          <option value={30}>30</option>
                        </select>
                      </div>
                    </div>

                    <div className="text-xs text-neutral-500">• 분은 00 또는 30만 선택할 수 있습니다.</div>
                    {draftOverrideDate ? (
                      <div className="text-xs text-neutral-500">
                        {formatYmdKor(draftOverrideDate)} 수업 현황 :{" "}
                        {teacherDateTimes.length > 0
                          ? teacherDateTimes.map((t) => `${t.time} (${t.name})`).join(", ")
                          : "해당 없음"}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={checkCarry}
                      onChange={(e) => toggleCarry(e.target.checked)}
                    />
                    <span>이월</span>
                  </label>

                  {checkCarry && (
                    <button
                      type="button"
                      className="rounded border border-neutral-300 px-2 py-1 text-xs"
                      onClick={resetCarryOnly}
                    >
                      초기화
                    </button>
                  )}
                </div>

                {checkCarry && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">이월된 수업 횟수</div>

                    <div className="flex items-center gap-6">
                      <button
                        className="rounded border border-neutral-300 px-2 py-1 text-sm"
                        onClick={() => setDraftCarry((x) => Math.max(0, Math.floor((x ?? 0) - 1)))}
                        type="button"
                      >
                        -
                      </button>

                      <div className="text-sm font-semibold">{Math.max(0, Math.floor(draftCarry ?? 0))}</div>

                      <button
                        className="rounded border border-neutral-300 px-2 py-1 text-sm"
                        onClick={() => setDraftCarry((x) => Math.max(0, Math.floor((x ?? 0) + 1)))}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {needReasonUI && (
                <>
                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">
                      사유 <span className="text-red-600">*</span>
                    </div>
                    <input
                      className="rounded border border-neutral-300 px-2 py-1"
                      value={draftReason}
                      onChange={(e) => setDraftReason(e.target.value)}
                      placeholder="사유를 입력해주세요"
                    />
                  </label>

                  <label className="grid gap-1">
                    <div className="text-sm font-semibold">기록(URL)</div>
                    <input
                      className="rounded border border-neutral-300 px-2 py-1 placeholder:text-neutral-400"
                      type="url"
                      value={draftRecord}
                      onChange={(e) => setDraftRecord(e.target.value)}
                      placeholder="캡쳐 화면 url 첨부"
                    />
                  </label>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="rounded border border-neutral-300 px-3 py-1" onClick={onCancel}>
                취소
              </button>
              <button className="rounded bg-black px-3 py-1 text-white" onClick={onSave}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
