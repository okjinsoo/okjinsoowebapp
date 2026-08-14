// lib/ui/session/SessionQuickActions.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { loadCurrentTeacherId } from "@/lib/storage/teachers";
import { buildStudentSessionsFromRows, readSnapshotServerFirst } from "@/lib/storage/serverRead";
import {
  buildBaseDatesISO,
  computeEffectiveISO,
  upsertMeta,
  useMetaMap,
  readMetaMap,
} from "@/lib/factories/sessionFactories";
import { syncSessionDisplayAtByToken } from "@/lib/ui/session/syncSessionDisplayAt";
import { canEditSessionMeta, type SessionRole } from "@/lib/policies/sessionRolePolicy";
import type { SessionMeta } from "@/lib/factories/sessionFactories";
import type { Session, Student } from "@/lib/types/index";
import {
  resolveDurationMinForSessionWithMeta,
  resolveRulesForIndex,
} from "@/lib/ui/session/sessionCardFactory";

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
  const [students, setStudents] = useState<Student[]>([]);
  const [allSessions, setAllSessions] = useState<Session[]>([]);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refreshSnapshot = async () => {
      const next = await readSnapshotServerFirst();
      if (cancelled) return;
      setStudents(next.students);
      setAllSessions(next.sessions);
      setTeacherId(loadCurrentTeacherId());
    };

    const requestRefresh = () => {
      void refreshSnapshot();
    };

    void refreshSnapshot();
    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
    window.addEventListener(TUTORWEB_EVENTS.sessionsUpdated, requestRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, requestRefresh);
      window.removeEventListener(TUTORWEB_EVENTS.sessionsUpdated, requestRefresh);
    };
  }, []);

  const metaMap = useMetaMap(token);
  const hydratedMetaMap = useMemo(() => (mounted ? metaMap : {}), [mounted, metaMap]);
  const currentStudent = useMemo(
    () => students.find((student) => student.token === token) ?? null,
    [students, token]
  );
  const baseDatesISO = useMemo(() => (currentStudent ? buildBaseDatesISO(currentStudent, 60) : []), [currentStudent]);

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
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);

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

  const currentSession = useMemo(() => {
    const owner = currentStudent;
    if (!owner) return null;
    return buildStudentSessionsFromRows({
      student: owner,
      allSessions,
    }).find((session) => session.index === index) ?? null;
  }, [currentStudent, allSessions, index]);

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

  const onSave = async (finalData: Partial<SessionMeta>) => {
    setIsSaving(true);
    try {
      await upsertMeta(token, index, {
        ...finalData,
        overrideSource: finalData.overrideDate ? "manual" : "",
      });
      await syncSessionDisplayAtByToken(token);
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

      {canEdit && open && portalRoot
        ? createPortal(
            <AdjustmentModalContent
              mode={openMode}
              meta={meta}
              token={token}
              index={index}
              teacherId={teacherId}
              students={students}
              allSessions={allSessions}
              onCancel={onCancel}
              onSave={onSave}
              isSaving={isSaving}
            />,
            portalRoot
          )
        : null}
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
  allSessions,
  onCancel,
  onSave,
  isSaving,
}: {
  mode: "edit" | "absent";
  meta: SessionMeta;
  token: string;
  index: number;
  teacherId: string | null;
  students: Student[];
  allSessions: Session[];
  onCancel: () => void;
  onSave: (finalData: Partial<SessionMeta>) => Promise<void>;
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
  const [draftOverrideMinute, setDraftOverrideMinute] = useState<number | null>(
    typeof meta.overrideMinute === "number" ? (meta.overrideMinute >= 30 ? 30 : 0) : 0
  );
  const [draftOverrideDurationHour, setDraftOverrideDurationHour] = useState<number | null>(
    typeof meta.overrideDurationMin === "number" && Number.isFinite(meta.overrideDurationMin)
      ? Math.max(1, Math.floor(meta.overrideDurationMin / 60))
      : null
  );
  const [draftReason, setDraftReason] = useState<string>(meta.reason ?? "");
  const [draftRecord, setDraftRecord] = useState<string>(meta.record ?? "");
  const overrideDateInputRef = useRef<HTMLInputElement | null>(null);

  const openOverrideDatePicker = () => {
    const input = overrideDateInputRef.current;
    if (!input) return;
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // 일부 브라우저는 showPicker를 지원하지 않아 포커스 fallback 사용
      }
    }
    input.focus();
  };

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
      setDraftOverrideMinute(0);
      setDraftOverrideDurationHour(null);
      return;
    }
    setDraftOverrideDate((prev) => (prev ? prev : ymdTodayLocal()));
    setDraftOverrideDurationHour((prev) => (prev && prev >= 1 ? prev : 1));
  };

  const toggleCarry = (next: boolean) => {
    setCheckCarry(next);
    if (!next) setDraftCarry(0);
  };

  const teacherDateTimes = useMemo(() => {
    if (!checkOverride || !draftOverrideDate || !teacherId) return [];
    const owned = students.filter((s) => (s.teacherId ?? null) === teacherId && s.token);
    const times: Array<{ label: string; sortKey: number; name: string }> = [];

    for (const st of owned) {
      const isSelf = st.token === token;
      const bDates = buildBaseDatesISO(st, 60);
      const mMap = readMetaMap(st.token);
      const sessList = buildStudentSessionsFromRows({
        student: st,
        allSessions,
      });

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
        const itemMeta = mMap[s.index] ?? {};
        const rules = resolveRulesForIndex(st, s.index);
        const durationMin = resolveDurationMinForSessionWithMeta(effectiveISO, rules, itemMeta);
        const timeRange = kstTimeRangeFromISO(effectiveISO, durationMin);
        if (!timeRange) continue;
        const startMs = new Date(effectiveISO).getTime();
        if (!Number.isFinite(startMs)) continue;
        times.push({
          label: `${st.name} | ${timeRange}`,
          sortKey: startMs,
          name: st.name,
        });
      }
    }
    return times
      .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name, "ko"))
      .map((row) => row.label);
  }, [checkOverride, draftOverrideDate, teacherId, students, allSessions, token, index]);

  const needReasonUI = checkAbsent || checkOverride || checkCarry;

  const handleSave = () => {
    if (checkOverride) {
      if (!draftOverrideDate) return alert("수업 변경일을 입력해주세요.");
      if (draftOverrideHour === null) return alert("수업 변경 시간을 선택해주세요.");
      if (draftOverrideDurationHour === null || draftOverrideDurationHour < 1) {
        return alert("수업 시간을 1시간 이상 입력해주세요.");
      }
    }
    if (checkCarry && !isNonNegInt(draftCarry)) return alert("이월 횟수는 0 이상의 정수여야 합니다.");
    if (needReasonUI && !draftReason.trim()) return alert("사유를 입력해주세요.");

    onSave({
      status: checkAbsent ? "absent" : checkPresent ? "present" : "planned",
      carry: checkCarry ? Number(draftCarry) : 0,
      overrideDate: checkOverride ? draftOverrideDate : "",
      overrideHour: checkOverride ? draftOverrideHour : null,
      overrideMinute: checkOverride ? (draftOverrideMinute ?? 0) : null,
      overrideDurationMin: checkOverride ? Math.max(1, Math.floor(draftOverrideDurationHour ?? 1)) * 60 : null,
      reason: needReasonUI ? draftReason : "",
      record: needReasonUI ? draftRecord : "",
    });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" style={{ zIndex: 3000 }}>
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
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-sm font-semibold">수업 변경일</div>
                  <div className="text-sm font-semibold">변경 시</div>
                  <div className="text-sm font-semibold">변경 분</div>
                  <div className="text-sm font-semibold">수업 시간</div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <input
                      ref={overrideDateInputRef}
                      className="w-full rounded border border-neutral-300 px-2 py-1"
                      style={{ borderColor: "var(--control-border)" }}
                      type="date"
                      value={draftOverrideDate}
                      onChange={(e) => setDraftOverrideDate(e.target.value)}
                      onClick={() => {
                        if (isSaving) return;
                        openOverrideDatePicker();
                      }}
                      disabled={isSaving}
                    />
                  </div>
                  <select
                    className="rounded border border-neutral-300 px-2 py-1"
                    style={{ borderColor: "var(--control-border)" }}
                    value={draftOverrideHour === null ? "" : draftOverrideHour}
                    onChange={(e) => setDraftOverrideHour(e.target.value === "" ? null : Number(e.target.value))}
                    disabled={isSaving}
                    aria-label="수업 변경 시작 시"
                  >
                    <option value="">시 선택</option>
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}시
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-neutral-300 px-2 py-1"
                    style={{ borderColor: "var(--control-border)" }}
                    value={draftOverrideMinute === null ? 0 : draftOverrideMinute}
                    onChange={(e) => setDraftOverrideMinute(Number(e.target.value) >= 30 ? 30 : 0)}
                    disabled={isSaving}
                    aria-label="수업 변경 시작 분"
                  >
                    <option value={0}>00분</option>
                    <option value={30}>30분</option>
                  </select>
                  <select
                    className="rounded border border-neutral-300 px-2 py-1"
                    style={{ borderColor: "var(--control-border)" }}
                    value={draftOverrideDurationHour === null ? "" : draftOverrideDurationHour}
                    onChange={(e) =>
                      setDraftOverrideDurationHour(e.target.value === "" ? null : Math.max(1, Number(e.target.value)))
                    }
                    disabled={isSaving}
                    aria-label="수업 변경 수업 시간"
                  >
                    <option value="">시간 선택</option>
                    {[1, 2].map((hours) => (
                      <option key={hours} value={hours}>
                        {hours}시간
                      </option>
                    ))}
                  </select>
                </div>
                {draftOverrideDate ? (
                  <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {formatYmdKor(draftOverrideDate)} 수업 현황 :{" "}
                    {teacherDateTimes.length > 0
                      ? teacherDateTimes.join(", ")
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

function formatTimeLabel(hour: string, minute: string): string {
  if (minute === "00") return `${hour}시`;
  return `${hour}시 ${minute}분`;
}

function kstTimeRangeFromISO(iso: string, durationMin: number): string | null {
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
    const normalizedDuration = Math.max(1, Math.floor(Number(durationMin) || 60));
    const end = new Date(dt.getTime() + normalizedDuration * 60 * 1000);
    const endParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(end);
    const ehh = endParts.find((p) => p.type === "hour")?.value ?? "00";
    const emm = endParts.find((p) => p.type === "minute")?.value ?? "00";
    return `${formatTimeLabel(hh, mm)} ~ ${formatTimeLabel(ehh, emm)}`;
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
