// lib/ui/session/SessionQuickActions.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { loadStudents } from "@/lib/storage/students";
import { pullSharedSnapshotAndHydrateWithOptions } from "@/lib/storage/sharedSnapshot";
import { loadCurrentTeacherId } from "@/lib/storage/teachers";
import { sessionsByStudent } from "@/lib/storage/sessions";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  upsertMeta,
  useMetaMap,
  readMetaMap,
} from "@/lib/factories/sessionFactories";
import { syncSessionDisplayAtByToken } from "@/lib/ui/session/syncSessionDisplayAt";
import { canEditSessionMeta, type SessionRole } from "@/lib/policies/sessionRolePolicy";

type Props = {
  role: SessionRole;
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
  const canEdit = canEditSessionMeta(role);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [students, setStudents] = useState(() => loadStudents());
  const [teacherId, setTeacherId] = useState<string | null>(null);
  const [sessionsTick, setSessionsTick] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => {
      setStudents(loadStudents());
      setTeacherId(loadCurrentTeacherId());
    }, 0);
    void pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true })
      .then((snapshot) => {
        if (snapshot) setStudents(snapshot.students);
      })
      .catch((err) => {
        console.error("학생 목록 서버 새로고침 실패(quick actions):", err);
      });
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onStudents = () => setStudents(loadStudents());
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, onStudents);
    return () => window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, onStudents);
  }, []);

  useEffect(() => {
    const onSessions = () => setSessionsTick((x) => x + 1);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, onSessions);
    return () => window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, onSessions);
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

  const [isSaving, setIsSaving] = useState(false);
  const togglePresent = async () => {
    if (!canEdit || isSaving) return;
    setIsSaving(true);
    try {
      await upsertMeta(token, index, { status: isPresent ? "planned" : "present" });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleAbsent = async () => {
    if (!canEdit || isSaving) return;
    if (isAbsent) {
      setIsSaving(true);
      try {
        await upsertMeta(token, index, { status: "planned" });
      } finally {
        setIsSaving(false);
      }
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

  const currentSession = useMemo(() => {
    void sessionsTick;
    const owner = students.find((s) => s.token === token);
    if (!owner) return null;
    return sessionsByStudent(owner.id).find((s) => s.index === index) ?? null;
  }, [sessionsTick, students, token, index]);

  const meetUrl = typeof currentSession?.googleMeetUrl === "string" ? currentSession.googleMeetUrl.trim() : "";
  const calendarStatus = currentSession?.googleCalendarStatus ?? "pending";
  const calendarError = typeof currentSession?.googleCalendarError === "string" ? currentSession.googleCalendarError.trim() : "";

  const openMeet = () => {
    if (!meetUrl) {
      if (calendarStatus === "error") {
        alert(
          `Meet 링크 생성에 실패했어요.\n원인: ${calendarError || "알 수 없는 오류"}\n\n` +
          "해결: Google Calendar API 활성화 + 다시 로그인(권한 동의) 후 다시 시도해주세요."
        );
        return;
      }
      if (calendarStatus === "pending" && calendarError) {
        alert(calendarError);
        return;
      }
      alert("아직 Meet 링크가 준비되지 않았어요. 잠시 뒤 다시 시도해주세요.");
      return;
    }
    window.open(meetUrl, "_blank", "noopener,noreferrer");
  };

  const onCancel = () => setOpen(false);

  const onSave = async (finalData: any) => {
    setIsSaving(true);
    try {
      await upsertMeta(token, index, {
        ...finalData,
        overrideSource: finalData.overrideDate ? "manual" : "",
      });
      syncSessionDisplayAtByToken(token);
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <button className={meetUrl ? "btn btn-green" : "btn btn-white"} onClick={openMeet} title="Google Meet 바로가기">
          미트
        </button>

        {canEdit ? (
          <>
            <button
              className={`${isPresent ? "btn btn-blue" : "btn btn-white"}`}
              onClick={togglePresent}
              disabled={isSaving}
            >
              {isSaving && isPresent ? "..." : "출석"}
            </button>

            <button
              className={`${isAbsent ? "btn btn-red" : "btn btn-white"}`}
              onClick={toggleAbsent}
              disabled={isSaving}
            >
              {isSaving && isAbsent ? "..." : "결석"}
            </button>

            <button className="btn btn-white btn-bold" onClick={openAdjustModal} disabled={isSaving}>
              조정
            </button>
          </>
        ) : null}
      </div>

      {canEdit && open && (
        <AdjustmentModalContent
          mode={openMode}
          meta={meta}
          token={token}
          index={index}
          teacherId={teacherId}
          students={students}
          onCancel={onCancel}
          onSave={onSave}
          isSaving={isSaving}
        />
      )}
    </>
  );
}

// ⚡ 모달 성능 최적화를 위한 독립형 서버 컴포넌트
function AdjustmentModalContent({
  mode,
  meta,
  token,
  index,
  teacherId,
  students,
  onCancel,
  onSave,
  isSaving,
}: {
  mode: "edit" | "absent";
  meta: any;
  token: string;
  index: number;
  teacherId: string | null;
  students: any[];
  onCancel: () => void;
  onSave: (finalData: any) => Promise<void>;
  isSaving: boolean;
}) {
  const [checkPresent, setCheckPresent] = useState(meta.status === "present");
  const [checkAbsent, setCheckAbsent] = useState(mode === "absent" ? true : meta.status === "absent");
  const [checkOverride, setCheckOverride] = useState(Boolean(meta.overrideDate));
  const [checkCarry, setCheckCarry] = useState(Number(meta.carry ?? 0) > 0);

  const [draftCarry, setDraftCarry] = useState<number>(typeof meta.carry === "number" ? meta.carry : 0);
  const [draftOverrideDate, setDraftOverrideDate] = useState<string>(meta.overrideDate ?? "");
  const [draftOverrideHour, setDraftOverrideHour] = useState<number | null>(
    typeof meta.overrideHour === "number" ? meta.overrideHour : null
  );
  const [draftOverrideMinute, setDraftOverrideMinute] = useState<0 | 30 | null>(
    meta.overrideMinute === 0 || meta.overrideMinute === 30 ? (meta.overrideMinute as 0 | 30) : null
  );
  const [draftReason, setDraftReason] = useState<string>(meta.reason ?? "");
  const [draftRecord, setDraftRecord] = useState<string>(meta.record ?? "");

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
  };

  const toggleCarry = (next: boolean) => {
    setCheckCarry(next);
    if (!next) setDraftCarry(0);
  };

  const teacherDateTimes = useMemo(() => {
    if (!checkOverride || !draftOverrideDate || !teacherId) return [];
    const owned = students.filter((s) => (s.teacherId ?? null) === teacherId && s.token);
    const times: Array<{ time: string; name: string }> = [];

    for (const st of owned) {
      const isSelf = st.token === token;
      const bDates = buildBaseDatesISOByToken(st.token, 60);
      const mMap = readMetaMap(st.token);
      const sessList = sessionsByStudent(st.id);

      for (const s of sessList) {
        if (isSelf && s.index === index) continue;
        const { effectiveISO } = computeEffectiveISO({
          token: st.token,
          index: s.index,
          baseDatesISO: bDates,
          metaMap: mMap,
        });
        if (!effectiveISO) continue;
        const ymd = kstYmdFromISO(effectiveISO);
        if (ymd !== draftOverrideDate) continue;
        const t = kstTimeFromISO(effectiveISO);
        if (t) times.push({ time: t, name: st.name });
      }
    }
    return times.sort((a, b) => a.time.localeCompare(b.time, "ko") || a.name.localeCompare(b.name, "ko"));
  }, [checkOverride, draftOverrideDate, teacherId, students, token, index]);

  const needReasonUI = checkAbsent || checkOverride || checkCarry;

  const handleSave = () => {
    if (checkOverride) {
      if (!draftOverrideDate) return alert("수업 변경일을 입력해주세요.");
      if (draftOverrideHour === null || draftOverrideMinute === null) return alert("수업 변경 시간을 선택해주세요.");
    }
    if (checkCarry && !isNonNegInt(draftCarry)) return alert("이월 횟수는 0 이상의 정수여야 합니다.");
    if (needReasonUI && !draftReason.trim()) return alert("사유를 입력해주세요.");

    onSave({
      status: checkAbsent ? "absent" : checkPresent ? "present" : "planned",
      carry: checkCarry ? Number(draftCarry) : 0,
      overrideDate: checkOverride ? draftOverrideDate : "",
      overrideHour: checkOverride ? draftOverrideHour : null,
      overrideMinute: checkOverride ? draftOverrideMinute : null,
      reason: needReasonUI ? draftReason : "",
      record: needReasonUI ? draftRecord : "",
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-lg rounded p-4 shadow"
        style={{
          background: "var(--surface-bg)",
          border: "1px solid var(--surface-border)",
          color: "var(--foreground)",
        }}
      >
        <div className="card-title">회차 조정</div>

        <div className="mt-3 grid gap-4">
          <div className="grid gap-2">
            <div className="text-sm font-semibold">출결</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clickPresent}
                className={`rounded border ${checkPresent ? "btn btn-blue" : "btn btn-white"}`}
                disabled={isSaving}
              >
                출석
              </button>
              <button
                type="button"
                onClick={clickAbsent}
                className={`rounded border ${checkAbsent ? "btn btn-red" : "btn btn-white"}`}
                disabled={isSaving}
              >
                결석
              </button>
            </div>
            <div className="text-xs" style={{ color: "var(--text-muted)" }}>
              • 같은 버튼을 한 번 더 누르면 해제됩니다.
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={checkOverride}
                  onChange={(e) => toggleOverride(e.target.checked)}
                  disabled={isSaving}
                />
                <span>변경</span>
              </label>
              {checkOverride && (
                <button
                  type="button"
                  className="rounded border border-neutral-300 px-2 py-1 text-xs"
                  style={{ borderColor: "var(--control-border)" }}
                  onClick={() => toggleOverride(false)}
                  disabled={isSaving}
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
                    style={{ borderColor: "var(--control-border)" }}
                    type="date"
                    value={draftOverrideDate}
                    onChange={(e) => setDraftOverrideDate(e.target.value)}
                    disabled={isSaving}
                  />
                  <div className="flex items-center gap-2">
                    <select
                      className="rounded border border-neutral-300 px-2 py-1"
                      style={{ borderColor: "var(--control-border)" }}
                      value={draftOverrideHour === null ? "" : draftOverrideHour}
                      onChange={(e) => setDraftOverrideHour(e.target.value === "" ? null : Number(e.target.value))}
                      disabled={isSaving}
                    >
                      <option value="">시 선택</option>
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, "0")}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                      :
                    </span>
                    <select
                      className="rounded border border-neutral-300 px-2 py-1"
                      style={{ borderColor: "var(--control-border)" }}
                      value={draftOverrideMinute === null ? "" : draftOverrideMinute}
                      onChange={(e) =>
                        setDraftOverrideMinute(e.target.value === "" ? null : (Number(e.target.value) as 0 | 30))
                      }
                      disabled={isSaving}
                    >
                      <option value="">분 선택</option>
                      <option value={0}>00</option>
                      <option value={30}>30</option>
                    </select>
                  </div>
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  • 분은 00 또는 30만 선택할 수 있습니다.
                </div>
                {draftOverrideDate ? (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
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
                  disabled={isSaving}
                />
                <span>이월</span>
              </label>
              {checkCarry && (
                <button
                  type="button"
                  className="rounded border border-neutral-300 px-2 py-1 text-xs"
                  style={{ borderColor: "var(--control-border)" }}
                  onClick={() => toggleCarry(false)}
                  disabled={isSaving}
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
                    style={{ borderColor: "var(--control-border)" }}
                    onClick={() => setDraftCarry((x) => Math.max(0, Math.floor((x ?? 0) - 1)))}
                    type="button"
                    disabled={isSaving}
                  >
                    -
                  </button>
                  <div className="text-sm font-semibold">{Math.max(0, Math.floor(draftCarry ?? 0))}</div>
                  <button
                    className="rounded border border-neutral-300 px-2 py-1 text-sm"
                    style={{ borderColor: "var(--control-border)" }}
                    onClick={() => setDraftCarry((x) => Math.max(0, Math.floor((x ?? 0) + 1)))}
                    type="button"
                    disabled={isSaving}
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
                  style={{ borderColor: "var(--control-border)" }}
                  value={draftReason}
                  onChange={(e) => setDraftReason(e.target.value)}
                  placeholder="사유를 입력해주세요"
                  disabled={isSaving}
                />
              </label>
              <label className="grid gap-1">
                <div className="text-sm font-semibold">기록(URL)</div>
                <input
                  className="rounded border border-neutral-300 px-2 py-1 placeholder:text-neutral-400"
                  style={{ borderColor: "var(--control-border)" }}
                  type="url"
                  value={draftRecord}
                  onChange={(e) => setDraftRecord(e.target.value)}
                  placeholder="캡쳐 화면 url 첨부"
                  disabled={isSaving}
                />
              </label>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="btn" onClick={onCancel} disabled={isSaving}>
            취소
          </button>
          <button className="btn btn-bold" onClick={handleSave} disabled={isSaving}>
            {isSaving ? "적용 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

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
