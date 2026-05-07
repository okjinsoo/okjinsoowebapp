"use client";

import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildBaseDatesISO,
  computeEffectiveISO,
  upsertMeta,
  buildBadges,
  readMetaMap,
  useMetaMap,
  getDdayMeta,
} from "@/lib/factories/sessionFactories";
import {
  buildGoogleAuthUrl,
} from "@/lib/auth/supabaseAuth";
import { fmtKST_yyyyMMdd_TimeRange } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import {
  calculateSessionAchievementPercent,
  isSessionProgressEventKeyForToken,
} from "@/lib/factories/sessionProgressFactory";
import { todayYmdKST } from "@/lib/utils/date";
import { syncSessionDisplayAtByToken } from "@/lib/ui/session/syncSessionDisplayAt";
import { canEditSessionMeta, type SessionRole } from "@/lib/policies/sessionRolePolicy";
import { Session, Student } from "@/lib/types/index";
import { useStudentSessionContext } from "@/lib/hooks/useStudentSessionContext";
import SessionCardRow from "@/lib/ui/session/SessionCardRow";
import {
  buildSessionCardViewModel,
  resolveDurationMinForSessionWithMeta,
  resolveRulesForIndex,
} from "@/lib/ui/session/sessionCardFactory";
import { buildStudentSessionsFromRows, readSnapshotServerFirst } from "@/lib/storage/serverRead";

type Props = {
  role: SessionRole;
  token: string;
  index: number;
};

function isNonNegInt(n: unknown): boolean {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) && Math.floor(x) === x && x >= 0;
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
    const end = new Date(dt.getTime() + Math.max(1, Math.floor(durationMin)) * 60 * 1000);
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
  const [, month, day] = ymd.split("-");
  const mm = String(Number(month ?? "0"));
  const dd = String(Number(day ?? "0"));
  return `${mm}월 ${dd}일`;
}

export default function SessionTopBarCore({ role, token, index }: Props) {
  const canEdit = canEditSessionMeta(role);

  // hydration mismatch 방지(오늘 날짜 기반 요소는 mounted 이후)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ✅ metaMap 배선 단일화
  const metaMap = useMetaMap(token);
  const hydratedMetaMap = useMemo(() => (mounted ? metaMap : {}), [mounted, metaMap]);

  // modal
  const [open, setOpen] = useState(false);
  const [openMode, setOpenMode] = useState<"edit" | "absent">("edit");

  // ✅ 조정 모달 상태(출결은 버튼형)
  const [checkPresent, setCheckPresent] = useState(false);
  const [checkAbsent, setCheckAbsent] = useState(false);

  const [checkOverride, setCheckOverride] = useState(false);
  const [checkCarry, setCheckCarry] = useState(false);

  const {
    student,
    sessions,
  } = useStudentSessionContext(token);
  const [snapshotStudents, setSnapshotStudents] = useState<Student[]>([]);
  const [snapshotSessions, setSnapshotSessions] = useState<Session[]>([]);
  const [progressTick, setProgressTick] = useState(0);

  // 이월
  const [draftCarry, setDraftCarry] = useState<number>(0);

  // 변경(날짜 + 시간(시/분) - 시간은 “선택 전” 상태가 필요해서 null 허용)
  const [draftOverrideDate, setDraftOverrideDate] = useState<string>("");
  const [draftOverrideHour, setDraftOverrideHour] = useState<number | null>(null);
  const [draftOverrideDurationHour, setDraftOverrideDurationHour] = useState<number | null>(null);
  const overrideDateInputRef = useRef<HTMLInputElement | null>(null);

  // 사유/기록
  const [draftReason, setDraftReason] = useState<string>("");
  const [draftRecord, setDraftRecord] = useState<string>("");

  const openOverrideDatePicker = () => {
    const input = overrideDateInputRef.current;
    if (!input) return;
    const pickerInput = input as HTMLInputElement & { showPicker?: () => void };
    if (typeof pickerInput.showPicker === "function") {
      try {
        pickerInput.showPicker();
        return;
      } catch {
        // 일부 브라우저는 showPicker 미지원
      }
    }
    input.focus();
  };

  // 구글 인증 에러 상태
  const [authError, setAuthError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    const onAuthError = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setAuthError(detail?.msg || "권한 만료");
    };

    window.addEventListener(TUTORWEB_EVENTS.googleAuthError, onAuthError);

    return () => {
      window.removeEventListener(TUTORWEB_EVENTS.googleAuthError, onAuthError);
    };
  }, []);

  useEffect(() => {
    const onBrowserStorageChanged: EventListener = (event) => {
      const ce = event as CustomEvent<{ key?: string | null }>;
      const key = ce.detail?.key ?? null;
      if (!key) return;
      if (!isSessionProgressEventKeyForToken(key, token)) return;
      setProgressTick((x) => x + 1);
    };

    window.addEventListener(BROWSER_STORAGE_EVENT, onBrowserStorageChanged);
    return () => {
      window.removeEventListener(BROWSER_STORAGE_EVENT, onBrowserStorageChanged);
    };
  }, [token]);

  const baseDatesISO = useMemo(() => (student ? buildBaseDatesISO(student, 60) : []), [student]);

  const { effectiveISO, meta } = useMemo(() => {
    return computeEffectiveISO({
      token,
      index,
      baseDatesISO,
      metaMap: hydratedMetaMap,
    });
  }, [token, index, baseDatesISO, hydratedMetaMap]);

  const badges = useMemo(() => buildBadges(meta), [meta]);

  // ✅ D-day 레고(계산+색규칙) 적용: mounted 이후만
  const dday = useMemo(() => {
    if (!mounted) return null;
    return getDdayMeta(effectiveISO, new Date());
  }, [mounted, effectiveISO]);


  const achievementPercent = useMemo((): number | null => {
    if (!mounted) return null;
    void progressTick;
    return calculateSessionAchievementPercent({
      token,
      sessionIndex: index,
    });
  }, [mounted, token, index, progressTick]);

  const lastClassIndex = null;

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.index === index) ?? null;
  }, [sessions, index]);

  const durationMin = useMemo(() => {
    if (!student) return 60;
    const rules = resolveRulesForIndex(student, index);
    return resolveDurationMinForSessionWithMeta(effectiveISO, rules, meta);
  }, [student, index, effectiveISO, meta]);

  const cardModel = useMemo(() => {
    const dateTimeText = mounted
      ? effectiveISO
        ? fmtKST_yyyyMMdd_TimeRange(effectiveISO, durationMin)
        : "예정일 없음"
      : "-";
    return buildSessionCardViewModel({
      index,
      dateTimeText,
      dday: dday && dday.diff !== null ? dday : null,
      status: meta.status ?? "planned",
      achievementPercent,
      extraBadges: mounted ? badges : [],
    });
  }, [index, mounted, effectiveISO, durationMin, dday, meta.status, achievementPercent, badges]);

  const meetUrl = typeof currentSession?.googleMeetUrl === "string" ? currentSession.googleMeetUrl.trim() : "";
  const calendarStatus = currentSession?.googleCalendarStatus ?? "pending";
  const calendarError = typeof currentSession?.googleCalendarError === "string" ? currentSession.googleCalendarError.trim() : "";

  // ===== 상단 버튼(토글) =====
  const isPresent = meta.status === "present";
  const isAbsent = meta.status === "absent";

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

    // 이미 결석이면 해제
    if (isAbsent) {
      setIsSaving(true);
      try {
        await upsertMeta(token, index, { status: "planned" });
      } finally {
        setIsSaving(false);
      }
      return;
    }

    // 결석이면 기존대로 모달 오픈 유지
    setOpenMode("absent");
    setOpen(true);
  };
  const openAdjustModal = () => {
    if (!canEdit) return;
    setOpenMode("edit");
    setOpen(true);
  };

  useEffect(() => {
    if (!open || !checkOverride || !draftOverrideDate || !student?.teacherId) return;
    let cancelled = false;
    void (async () => {
      const snapshot = await readSnapshotServerFirst();
      if (cancelled) return;
      setSnapshotStudents(snapshot.students);
      setSnapshotSessions(snapshot.sessions);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, checkOverride, draftOverrideDate, student?.teacherId]);

  const teacherDateTimes = useMemo(() => {
    if (!open || !checkOverride || !draftOverrideDate || !student?.teacherId) return [] as string[];
    const owned = snapshotStudents.filter((s) => (s.teacherId ?? null) === (student.teacherId ?? null) && s.token);
    const rows: Array<{ label: string; sortKey: number; name: string }> = [];
    for (const st of owned) {
      const isSelf = st.token === token;
      const bDates = buildBaseDatesISO(st, 60);
      const map = readMetaMap(st.token);
      const sessionRows = buildStudentSessionsFromRows({ student: st, allSessions: snapshotSessions });
      for (const row of sessionRows) {
        if (isSelf && row.index === index) continue;
        const { effectiveISO } = computeEffectiveISO({
          token: st.token,
          index: row.index,
          baseDatesISO: bDates,
          metaMap: map,
        });
        if (!effectiveISO) continue;
        const ymd = kstYmdFromISO(effectiveISO);
        if (ymd !== draftOverrideDate) continue;
        const itemMeta = map[row.index] ?? {};
        const rules = resolveRulesForIndex(st, row.index);
        const durationMin = resolveDurationMinForSessionWithMeta(effectiveISO, rules, itemMeta);
        const range = kstTimeRangeFromISO(effectiveISO, durationMin);
        if (!range) continue;
        const ms = new Date(effectiveISO).getTime();
        if (!Number.isFinite(ms)) continue;
        rows.push({ label: `${st.name} | ${range}`, sortKey: ms, name: st.name });
      }
    }
    return rows
      .sort((a, b) => a.sortKey - b.sortKey || a.name.localeCompare(b.name, "ko"))
      .map((row) => row.label);
  }, [open, checkOverride, draftOverrideDate, student?.teacherId, snapshotStudents, snapshotSessions, token, index]);

  // ===== 모달 열릴 때 meta -> draft 복사 =====
  useEffect(() => {
    if (!open) return;

    setCheckPresent(meta.status === "present");
    setCheckAbsent(meta.status === "absent");

    const hasOverride = Boolean(meta.overrideDate);
    setCheckOverride(hasOverride);
    setDraftOverrideDate(meta.overrideDate ?? "");

    const hh = meta.overrideHour ?? null;
    const durationHour =
      typeof meta.overrideDurationMin === "number" && Number.isFinite(meta.overrideDurationMin)
        ? Math.max(1, Math.floor(meta.overrideDurationMin / 60))
        : null;

    setDraftOverrideHour(typeof hh === "number" ? hh : null);
    setDraftOverrideDurationHour(durationHour);

    const carryVal = meta.carry ?? 0;
    const hasCarry = Number(carryVal) > 0;
    setCheckCarry(hasCarry);
    setDraftCarry(typeof carryVal === "number" ? carryVal : 0);

    setDraftReason(meta.reason ?? "");
    setDraftRecord(meta.record ?? "");

    // 결석 버튼에서 들어오면 결석 활성(출석 비활성)
    if (openMode === "absent") {
      setCheckAbsent(true);
      setCheckPresent(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ===== 모달 내 출결 버튼(한 줄) =====
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

  // ===== 변경/이월 체크 =====
  const toggleOverride = (next: boolean) => {
    setCheckOverride(next);

    if (!next) {
      setDraftOverrideDate("");
      setDraftOverrideHour(null);
      setDraftOverrideDurationHour(null);
      return;
    }

    // ✅ 켜는 순간: 날짜만 오늘로 세팅(없을 때만), 시간은 일부러 비워둠
    setDraftOverrideDate((prev) => (prev ? prev : todayYmdKST()));
    setDraftOverrideHour(null);
    setDraftOverrideDurationHour((prev) => (prev && prev >= 1 ? prev : 1));
  };

  const toggleCarry = (next: boolean) => {
    setCheckCarry(next);
    if (!next) setDraftCarry(0);
  };

  // ✅ 변경/이월 개별 초기화(모달 안 닫힘)
  const resetOverrideOnly = () => {
    setCheckOverride(false);
    setDraftOverrideDate("");
    setDraftOverrideHour(null);
    setDraftOverrideDurationHour(null);
  };

  const resetCarryOnly = () => {
    setCheckCarry(false);
    setDraftCarry(0);
  };

  // ✅ 사유/기록 노출 조건
  const needReasonUI = checkAbsent || checkOverride || checkCarry;

  // ✅ 저장 가능 조건
  function canSave(): { ok: boolean; msg?: string } {
    if (checkOverride) {
      if (!draftOverrideDate) {
        return { ok: false, msg: "변경을 체크했다면 ‘수업 변경일’을 입력해야 합니다." };
      }
      if (draftOverrideHour === null) {
        return {
          ok: false,
          msg: "변경을 체크했다면 ‘수업 변경 시간’을 선택해야 합니다.",
        };
      }
      if (draftOverrideDurationHour === null || draftOverrideDurationHour < 1) {
        return { ok: false, msg: "수업 시간을 1시간 이상 입력해주세요." };
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

  const onSave = async () => {
    const chk = canSave();
    if (!chk.ok) {
      alert(chk.msg ?? "입력값을 확인해주세요.");
      return;
    }

    const status = checkAbsent ? "absent" : checkPresent ? "present" : "planned";

    const h = checkOverride ? (draftOverrideHour ?? 0) : 0;
    const durationMin = checkOverride ? Math.max(1, Math.floor(draftOverrideDurationHour ?? 1)) * 60 : null;

    setIsSaving(true);
    try {
      await upsertMeta(token, index, {
        status,
        carry: checkCarry ? Number(draftCarry) : 0,
        overrideDate: checkOverride ? draftOverrideDate : "",
        overrideHour: checkOverride ? h : null,
        overrideMinute: checkOverride ? 0 : null,
        overrideDurationMin: durationMin,
        overrideSource: checkOverride ? "manual" : "",
        reason: needReasonUI ? draftReason : "",
        record: needReasonUI ? draftRecord : "",
      });
      await syncSessionDisplayAtByToken(token);
      setOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

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

  return (
    <div
      style={{
        position: "relative",
      }}
    >
      {/* 구글 인증 에러 긴급 복구 배너 */}
      {authError && (
        <div 
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 100,
            background: "#fff1f2",
            border: "1px solid #fecaca",
            padding: "8px 12px",
            marginTop: 8,
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            boxShadow: "0 4px 12px rgba(225, 29, 72, 0.15)",
            animation: "slideIn 0.3s ease-out"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#e11d48", fontSize: 13, fontWeight: 600 }}>
            <span style={{ fontSize: 16 }}>⚠️</span>
            <span>구글 캘린더 작업 중 권한 오류가 발생했습니다. (사유: {authError.substring(0, 40)}...)</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => {
                const needsCalendar = role === "a" || role === "t";
                const nextPath = `${window.location.pathname}${window.location.search}`;
                const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
                const url = buildGoogleAuthUrl(redirectTo, needsCalendar, { forceConsent: true });
                if (url) window.location.href = url;
              }}
              style={{
                background: "#e11d48",
                color: "white",
                border: "none",
                padding: "6px 12px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 2px 4px rgba(225, 29, 72, 0.2)"
              }}
            >
              지금 바로 다시 연결하기
            </button>
            <button
              onClick={() => setAuthError(null)}
              style={{
                background: "white",
                color: "#64748b",
                border: "1px solid #e2e8f0",
                padding: "6px 10px",
                borderRadius: 8,
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              닫기
            </button>
          </div>
          <style jsx>{`
            @keyframes slideIn {
              from { opacity: 0; transform: translateY(-10px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>
        </div>
      )}

      <SessionCardRow
        model={cardModel}
        inlineBadgeSlot={
          <>
            {lastClassIndex && index === lastClassIndex ? (
              <Badge className="bg-red-500 text-white">마지막 수업</Badge>
            ) : null}
          </>
        }
        rightSlot={
          <>
            <button className={meetUrl ? "btn btn-green" : "btn"} onClick={openMeet} title="Google Meet 바로가기">
              미트
            </button>

            {canEdit ? (
              <>
                <button
                  className={`rounded border ${isPresent ? "btn btn-blue" : "btn"}`}
                  onClick={togglePresent}
                  disabled={isSaving}
                >
                  {isSaving && isPresent ? "적용 중..." : "출석"}
                </button>

                <button
                  className={`rounded border ${isAbsent ? "btn btn-red" : "btn"}`}
                  onClick={toggleAbsent}
                  disabled={isSaving}
                >
                  {isSaving && isAbsent ? "적용 중..." : "결석"}
                </button>
                <button
                  className="rounded border border-neutral-300 bg-transparent btn btn-bold"
                  onClick={openAdjustModal}
                >
                  조정
                </button>
              </>
            ) : null}
          </>
        }
      />

      {/* Modal */}
      {open && (
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
              {/* 출결 */}
              <div className="grid gap-2">
                <div className="text-sm font-semibold">출결</div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={clickPresent}
                    className={`rounded border ${checkPresent ? "btn btn-blue" : "btn"}`}
                  >
                    출석
                  </button>

                  <button
                    type="button"
                    onClick={clickAbsent}
                    className={`rounded border ${checkAbsent ? "btn btn-red" : "btn"}`}
                  >
                    결석
                  </button>
                </div>

                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  • 같은 버튼을 한 번 더 누르면 해제됩니다.
                </div>
              </div>

              {/* 변경 */}
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
                      style={{ borderColor: "var(--control-border)" }}
                      onClick={resetOverrideOnly}
                    >
                      초기화
                    </button>
                  )}
                </div>

                {checkOverride && (
                  <div className="grid gap-2">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="text-sm font-semibold">수업 변경일</div>
                      <div className="text-sm font-semibold">수업 변경 시간</div>
                      <div className="text-sm font-semibold">수업 시간</div>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <input
                          ref={overrideDateInputRef}
                          className="w-full rounded border border-neutral-300 px-2 py-1"
                          style={{ borderColor: "var(--control-border)" }}
                          type="date"
                          value={draftOverrideDate}
                          onChange={(e) => setDraftOverrideDate(e.target.value)}
                          onClick={openOverrideDatePicker}
                        />
                      </div>

                      <select
                        className="rounded border border-neutral-300 px-2 py-1"
                        style={{ borderColor: "var(--control-border)" }}
                        value={draftOverrideHour === null ? "" : draftOverrideHour}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftOverrideHour(v === "" ? null : Number(v));
                        }}
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
                        value={draftOverrideDurationHour === null ? "" : draftOverrideDurationHour}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDraftOverrideDurationHour(v === "" ? null : Math.max(1, Number(v)));
                        }}
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
                        {teacherDateTimes.length > 0 ? teacherDateTimes.join(", ") : "해당 없음"}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* 이월 */}
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
                      style={{ borderColor: "var(--control-border)" }}
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
                        style={{ borderColor: "var(--control-border)" }}
                        onClick={() => setDraftCarry((x) => Math.max(0, Math.floor((x ?? 0) - 1)))}
                        type="button"
                      >
                        -
                      </button>

                      <div className="text-sm font-semibold">{Math.max(0, Math.floor(draftCarry ?? 0))}</div>

                      <button
                        className="rounded border border-neutral-300 px-2 py-1 text-sm"
                        style={{ borderColor: "var(--control-border)" }}
                        onClick={() => setDraftCarry((x) => Math.max(0, Math.floor((x ?? 0) + 1)))}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 사유/기록 */}
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
                    />
                  </label>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button className="btn" onClick={onCancel} disabled={isSaving}>
                취소
              </button>
              <button className="btn btn-bold" onClick={onSave} disabled={isSaving}>
                {isSaving ? "적용 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
