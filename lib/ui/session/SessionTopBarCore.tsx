"use client";

import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildBaseDatesISO,
  computeEffectiveISO,
  upsertMeta,
  buildBadges,
  useMetaMap,
  getDdayMeta,
} from "@/lib/factories/sessionFactories";
import {
  normalizeConsultPurpose,
} from "@/lib/factories/consultationFactory";
import {
  buildGoogleAuthUrl,
} from "@/lib/auth/supabaseAuth";
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import AchievementBadge from "@/lib/ui/common/AchievementBadge";
import { getSessionStatusBadge } from "@/lib/ui/common/sessionStatusBadge";
import { upsertStudent } from "@/lib/storage/students";
import { saveConsultationsByStudent } from "@/lib/storage/consultations";
import { buildConsultationMap, pickPrimaryConsultTag } from "@/lib/ui/session/consultationMap";
import { findClassIndexByDatePreferFuture, findLastClassIndex } from "@/lib/ui/session/pauseHelpers";
import { buildDisplayRecords, computeRefundRatio } from "@/lib/factories/lessonStatusFactory";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import ConsultModal, { ConsultFormState } from "@/lib/ui/common/ConsultModal";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import {
  calculateSessionAchievementPercent,
  isSessionProgressEventKeyForToken,
} from "@/lib/factories/sessionProgressFactory";
import { useConsultationSubmit } from "../student/hooks/useConsultationSubmit";
import { todayYmdKST } from "@/lib/utils/date";
import { syncSessionDisplayAtByToken } from "@/lib/ui/session/syncSessionDisplayAt";
import { canEditSessionMeta, type SessionRole } from "@/lib/policies/sessionRolePolicy";
import { ConsultationRecord, PaymentRecord, Student } from "@/lib/types/index";
import { useStudentSessionContext } from "@/lib/hooks/useStudentSessionContext";

type Props = {
  role: SessionRole;
  token: string;
  index: number;
};

function isNonNegInt(n: unknown): boolean {
  const x = typeof n === "number" ? n : Number(n);
  return Number.isFinite(x) && Math.floor(x) === x && x >= 0;
}

export default function SessionTopBarCore({ role, token, index }: Props) {
  const canEdit = canEditSessionMeta(role);
  const isAdmin = role === "a";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

  const [consultOpen, setConsultOpen] = useState(false);
  const [consultEditingId, setConsultEditingId] = useState<string | null>(null);
  const {
    student,
    sessions,
    consultRecords,
    refresh: refreshStudentContext,
    setStudent,
    setConsultRecords,
  } = useStudentSessionContext(token);
  const [progressTick, setProgressTick] = useState(0);
  const [consultForm, setConsultForm] = useState<ConsultFormState>({
    date: todayYmdKST(),
    purpose: "general",
    target: "student",
    content: "",
    adminConsultDate: "",
    extensionResult: "",
    extensionPaymentDate: todayYmdKST(),
    extensionAddedCount: 12,
    extensionPaymentConfirmed: false,
    finalNote: "",
    finalResult: "",
    pauseEffectiveDate: "",
    pauseRefundRatio: "",
    pauseRefundCompleted: false,
  });
  const [consultError, setConsultError] = useState("");

  // 이월
  const [draftCarry, setDraftCarry] = useState<number>(0);

  // 변경(날짜 + 시간(시/분) - 시간은 “선택 전” 상태가 필요해서 null 허용)
  const [draftOverrideDate, setDraftOverrideDate] = useState<string>("");
  const [draftOverrideHour, setDraftOverrideHour] = useState<number | null>(null);
  const [draftOverrideMinute, setDraftOverrideMinute] = useState<0 | 30 | null>(null);

  // 사유/기록
  const [draftReason, setDraftReason] = useState<string>("");
  const [draftRecord, setDraftRecord] = useState<string>("");

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


  const consultMap = useMemo(() => {
    if (!student) return {};
    return buildConsultationMap({
      token,
      sessions,
      records: consultRecords,
      baseDatesISO,
      metaMap: hydratedMetaMap,
    });
  }, [student, token, sessions, consultRecords, baseDatesISO, hydratedMetaMap]);
  const studentHistory = useMemo(() => {
    if (!student) return [];
    const h = student.paymentHistory ?? [];
    return h;
  }, [student]);

  const displayRecords = useMemo(() => {
    if (!student) return [];
    return buildDisplayRecords(student, studentHistory).displayRecords;
  }, [student, studentHistory]);

  const computeRefundRatioValue = (pauseEffectiveDate: string) => {
    if (!student || consultForm.purpose !== "pause_request" || consultForm.finalResult !== "pause_confirm") return "";
    const lastIdx = findClassIndexByDatePreferFuture({
      token,
      sessions,
      baseDatesISO,
      metaMap: hydratedMetaMap,
      targetDate: pauseEffectiveDate,
    });
    if (!lastIdx) return "";
    const requestIndex = lastIdx + 1;
    const refundTarget = displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex);
    return refundTarget
      ? computeRefundRatio(refundTarget, requestIndex, Boolean(refundTarget.isBase))
      : "";
  };

  const consultTag = pickPrimaryConsultTag(consultMap[index]);

  const achievementPercent = useMemo((): number | null => {
    if (!mounted) return null;
    void progressTick;
    return calculateSessionAchievementPercent({
      token,
      sessionIndex: index,
    });
  }, [mounted, token, index, progressTick]);

  const lastClassIndex = useMemo(() => {
    if (!student || (student.pauseStatus !== "confirmed" && student.pauseStatus !== "paused") || !student.pauseEffectiveDate) return null;
    return findLastClassIndex({
      token,
      sessions,
      baseDatesISO,
      metaMap: hydratedMetaMap,
      pauseEffectiveDate: student.pauseEffectiveDate,
    });
  }, [student, token, sessions, baseDatesISO, hydratedMetaMap]);

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.index === index) ?? null;
  }, [sessions, index]);
  const maxSessionIndex = useMemo(() => {
    if (sessions.length === 0) return 0;
    return sessions.reduce((max, row) => Math.max(max, row.index), 0);
  }, [sessions]);

  const buildSessionHref = (targetIndex: number): string | null => {
    if (!Number.isFinite(targetIndex) || targetIndex < 1) return null;

    const path = pathname ?? "";
    const nextPath = /\/session\/\d+\/?$/.test(path)
      ? path.replace(/\/session\/\d+\/?$/, `/session/${targetIndex}`)
      : `/${role}/smain/session/${targetIndex}`;

    const nextQuery = new URLSearchParams(searchParams?.toString() ?? "");
    const hasTokenPath = /\/(?:tmain|students)\/[^/]+\/session\//.test(nextPath);
    if (hasTokenPath) nextQuery.delete("token");
    else nextQuery.set("token", token);

    const query = nextQuery.toString();
    return query ? `${nextPath}?${query}` : nextPath;
  };

  const prevHref = buildSessionHref(index - 1);
  const nextHref = maxSessionIndex > 0 && index >= maxSessionIndex ? null : buildSessionHref(index + 1);

  const meetUrl = typeof currentSession?.googleMeetUrl === "string" ? currentSession.googleMeetUrl.trim() : "";
  const calendarStatus = currentSession?.googleCalendarStatus ?? "pending";
  const calendarError = typeof currentSession?.googleCalendarError === "string" ? currentSession.googleCalendarError.trim() : "";

  // ===== 상단 버튼(토글) =====
  const isPresent = meta.status === "present";
  const isAbsent = meta.status === "absent";
  const statusBadge = getSessionStatusBadge(meta.status);

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

  const ymdFromISO = (iso: string | null | undefined) => {
    if (!iso) return todayYmdKST();
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(iso));
    const y = parts.find((p) => p.type === "year")?.value ?? "1970";
    const m = parts.find((p) => p.type === "month")?.value ?? "01";
    const d = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${y}-${m}-${d}`;
  };

  const openConsultModal = () => {
    if (consultTag?.recordId) {
      const record = consultRecords.find((r) => r.id === consultTag.recordId);
      if (record) {
        setConsultEditingId(record.id);
        setConsultForm({
          date: record.date || ymdFromISO(effectiveISO),
          purpose: normalizeConsultPurpose((record as { purpose?: unknown }).purpose),
          target: record.target ?? "student",
          content: record.content ?? "",
          adminConsultDate: record.adminConsultDate ?? "",
          extensionResult: record.extensionResult ?? "",
          extensionPaymentDate: record.extensionPaymentDate ?? todayYmdKST(),
          extensionAddedCount: Math.max(1, Math.floor(Number(record.extensionAddedCount) || 12)),
          extensionPaymentConfirmed: Boolean(record.extensionPaymentConfirmed),
          finalNote: record.finalNote ?? "",
          finalResult: record.finalResult ?? "",
          pauseEffectiveDate: record.pauseEffectiveDate ?? "",
          pauseRefundRatio: record.pauseRefundRatio ?? "",
          pauseRefundCompleted: Boolean(record.pauseRefundCompleted),
        });
        setConsultError("");
        setConsultOpen(true);
        return;
      }
    }
    setConsultEditingId(null);
    setConsultForm({
      date: ymdFromISO(effectiveISO),
      purpose: consultTag?.purpose ?? "general",
      target: consultTag?.target ?? "student",
      content: "",
      adminConsultDate: "",
      extensionResult: "",
      extensionPaymentDate: todayYmdKST(),
      extensionAddedCount: 12,
      extensionPaymentConfirmed: false,
      finalNote: "",
      finalResult: "",
      pauseEffectiveDate: "",
      pauseRefundRatio: "",
      pauseRefundCompleted: false,
    });
    setConsultError("");
    setConsultOpen(true);
  };

  const { submit: submitConsult } = useConsultationSubmit({
    isAdmin,
    student,
    history: studentHistory,
    consultRecords: consultRecords ?? [],
    sessions,
    token,
    applyHistory: async (recs: PaymentRecord[], patch?: Partial<Student>, skip?: boolean, opts?: { consultationRecords?: ConsultationRecord[] }) => {
      if (!student) return false;
      const nextConsultRecords = opts?.consultationRecords ?? consultRecords;
      const updatedStudent = { ...student, ...patch, paymentHistory: recs };
      upsertStudent(updatedStudent);
      saveConsultationsByStudent(student.id, nextConsultRecords);
      setStudent(updatedStudent);
      setConsultRecords(nextConsultRecords);
      return true;
    },
    persistConsultationState: async (recs: ConsultationRecord[], patch?: Student) => {
      if (!student) return false;
      if (patch) {
        upsertStudent(patch);
        setStudent(patch);
      }
      saveConsultationsByStudent(student.id, recs);
      setConsultRecords(recs);
      return true;
    },
  });

  const saveConsultRecord = async (finalForm: ConsultFormState) => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const res = await submitConsult(finalForm, consultEditingId);
      if (res.error) {
        setConsultError(res.error);
        return;
      }
      if (res.ok) {
        setConsultOpen(false);
        void refreshStudentContext();
      }
    } finally {
      setIsSaving(false);
    }
  };
  const deleteConsultRecord = () => {
    if (!student || !consultEditingId) return;
    const updated = consultRecords.filter((r) => r.id !== consultEditingId);
    saveConsultationsByStudent(student.id, updated);
    setConsultRecords(updated);
    setConsultOpen(false);
    void refreshStudentContext();
  };

  // ===== 모달 열릴 때 meta -> draft 복사 =====
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
      setDraftOverrideMinute(null);
      return;
    }

    // ✅ 켜는 순간: 날짜만 오늘로 세팅(없을 때만), 시간은 일부러 비워둠
    setDraftOverrideDate((prev) => (prev ? prev : todayYmdKST()));
    setDraftOverrideHour(null);
    setDraftOverrideMinute(null);
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
    setDraftOverrideMinute(null);
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

  const onSave = async () => {
    const chk = canSave();
    if (!chk.ok) {
      alert(chk.msg ?? "입력값을 확인해주세요.");
      return;
    }

    const status = checkAbsent ? "absent" : checkPresent ? "present" : "planned";

    const h = checkOverride ? (draftOverrideHour ?? 0) : 0;
    const m = checkOverride ? (draftOverrideMinute ?? 0) : 0;

    setIsSaving(true);
    try {
      await upsertMeta(token, index, {
        status,
        carry: checkCarry ? Number(draftCarry) : 0,
        overrideDate: checkOverride ? draftOverrideDate : "",
        overrideHour: checkOverride ? h : null,
        overrideMinute: checkOverride ? m : null,
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
        border: "1px solid var(--surface-border)",
        borderRadius: 10,
        padding: "8px 10px",
        background: "var(--surface-bg)",
      }}
      className="flex items-center justify-between gap-3"
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

      {/* 좌측: 회차 목록 카드 레이아웃과 1:1 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "110px 1fr",
          gap: 30,
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, whiteSpace: "nowrap" }}>
          {dday && dday.diff !== null ? <Badge className={`text-white ${dday.className}`}>{dday.label}</Badge> : null}
          <span>{index}회차</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-dim">
          <div>{mounted ? (effectiveISO ? fmtKST_yyyyMMdd_HHmm_noSeconds(effectiveISO) : "예정일 없음") : "-"}</div>
          <Badge style={statusBadge.style}>{statusBadge.label}</Badge>
          <AchievementBadge percent={achievementPercent} />
          {!(
            lastClassIndex &&
            index === lastClassIndex &&
            consultTag &&
            consultTag.label === "휴회 예정"
          ) ? (
            <ConsultBadge tag={consultTag} />
          ) : null}
          {lastClassIndex && index === lastClassIndex ? (
            <Badge className="bg-red-500 text-white">마지막 수업</Badge>
          ) : null}
          {mounted && badges.length > 0
            ? badges.map((b) => (
              <Badge key={`${index}:${b}`} className="bg-slate-100 text-slate-700">
                {b}
              </Badge>
            ))
            : null}
        </div>
      </div>

      {/* 우측 버튼 */}
      <div className="flex items-center gap-2">
        <button
          className="btn"
          onClick={() => {
            if (!prevHref) return;
            router.push(prevHref);
          }}
          disabled={!prevHref || isSaving}
        >
          이전 학습
        </button>
        <button
          className="btn"
          onClick={() => {
            if (!nextHref) return;
            router.push(nextHref);
          }}
          disabled={!nextHref || isSaving}
        >
          이후 학습
        </button>
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

            <ConsultButton tag={consultTag} onClick={openConsultModal} />
          </>
        ) : null}
      </div>

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
                      />

                      <div className="flex items-center gap-2">
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

                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                      • 분은 00 또는 30만 선택할 수 있습니다.
                    </div>
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

      <ConsultModal
        open={consultOpen}
        role={role}
        state={consultForm}
        error={consultError}
        onClose={() => setConsultOpen(false)}
        onSave={saveConsultRecord}
        onDelete={isAdmin ? deleteConsultRecord : undefined}
        loading={isSaving}
        computeRefundRatioValue={computeRefundRatioValue}
      />
    </div>
  );
}
