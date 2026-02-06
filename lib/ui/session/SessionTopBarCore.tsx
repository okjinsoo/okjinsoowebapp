"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  upsertMeta,
  buildBadges,
  getStatusStyle,
  useMetaMap,
  getDdayMeta,
} from "@/lib/factories/sessionFactories";
import { buildConsultationRecord, normalizeConsultPurpose, validateConsultForm } from "@/lib/factories/consultationFactory";
import { fmtKST_yyyyMMdd_HHmm_noSeconds } from "@/lib/ui/session/format";
import Badge from "@/lib/ui/common/Badge";
import { findStudentByToken, upsertStudent } from "@/lib/storage/students";
import { sessionsByStudent } from "@/lib/storage/sessions";
import { loadConsultationsByStudent, saveConsultationsByStudent } from "@/lib/storage/consultations";
import { buildConsultationMap, pickPrimaryConsultTag } from "@/lib/ui/session/consultationMap";
import { findClassIndexByDatePreferFuture, findLastClassIndex } from "@/lib/ui/session/pauseHelpers";
import { buildDisplayRecords, computeRefundRatio } from "@/lib/factories/lessonStatusFactory";
import { computePauseLifecycle } from "@/lib/factories/studentStatusFactory";
import { ConsultBadge, ConsultButton } from "@/lib/ui/common/ConsultParts";
import ConsultModal, { ConsultFormState } from "@/lib/ui/common/ConsultModal";

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

export default function SessionTopBarCore({ role, token, index }: Props) {
  const canEdit = role === "a" || role === "t";
  const isAdmin = role === "a";

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
  const [consultForm, setConsultForm] = useState<ConsultFormState>({
    date: ymdTodayLocal(),
    purpose: "general",
    target: "student",
    content: "",
    adminConsultDate: "",
    extensionResult: "",
    extensionPaymentDate: ymdTodayLocal(),
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

  const baseDatesISO = useMemo(() => buildBaseDatesISOByToken(token, 60), [token]);

  const student = useMemo(() => findStudentByToken(token) ?? null, [token]);
  const sessions = useMemo(() => (student ? sessionsByStudent(student.id) : []), [student]);
  const consultRecords = useMemo(() => (student ? loadConsultationsByStudent(student.id) : []), [student]);

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
  const displayRecords = useMemo(() => {
    if (!student) return [];
    const history = student.paymentHistory ?? [];
    return buildDisplayRecords(student, history).displayRecords;
  }, [student]);

  useEffect(() => {
    if (!student) return;
    if (consultForm.purpose !== "pause_request" || consultForm.finalResult !== "pause_confirm") return;
    if (!consultForm.pauseEffectiveDate) return;

    const lastIdx = findClassIndexByDatePreferFuture({
      token,
      sessions,
      baseDatesISO,
      metaMap: hydratedMetaMap,
      targetDate: consultForm.pauseEffectiveDate,
    });
    if (!lastIdx) return;
    const requestIndex = lastIdx + 1;
    const refundTarget = displayRecords.find((r) => requestIndex >= r.startIndex && requestIndex <= r.endIndex);
    const nextRatio = refundTarget
      ? computeRefundRatio(refundTarget, requestIndex, Boolean(refundTarget.isBase))
      : "";
    if (consultForm.pauseRefundRatio !== nextRatio) {
      setConsultForm((prev) => ({ ...prev, pauseRefundRatio: nextRatio }));
    }
  }, [
    student,
    consultForm.purpose,
    consultForm.finalResult,
    consultForm.pauseEffectiveDate,
    consultForm.pauseRefundRatio,
    token,
    sessions,
    baseDatesISO,
    hydratedMetaMap,
    displayRecords,
  ]);

  const consultTag = pickPrimaryConsultTag(consultMap[index]);

  const achievementPercent = useMemo(() => {
    if (!mounted) return 0;
    const readJson = <T,>(key: string, fallback: T): T => {
      if (typeof window === "undefined") return fallback;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
      } catch {
        return fallback;
      }
    };
    const baseKey = `mk3:${token}:session:${index}`;
    const leafIds = readJson<string[]>(`${baseKey}:leafIds`, []);
    const progress = readJson<Record<string, { noteDone?: boolean; solveDone?: boolean }>>(
      `${baseKey}:progressByLeafId`,
      {}
    );
    const ids = Array.isArray(leafIds) ? leafIds : [];
    const total = ids.length * 2;
    const done = ids.reduce((acc, id) => {
      const p = progress?.[id];
      return acc + (p?.noteDone ? 1 : 0) + (p?.solveDone ? 1 : 0);
    }, 0);
    return total === 0 ? 0 : Math.round((done / total) * 100);
  }, [mounted, token, index]);

  const achievementColor =
    achievementPercent >= 80
      ? "#16a34a"
      : achievementPercent >= 75
        ? "#2563eb"
        : achievementPercent >= 50
          ? "#ea580c"
          : "#dc2626";

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

  // ===== 상단 버튼(토글) =====
  const isPresent = meta.status === "present";
  const isAbsent = meta.status === "absent";
  const statusLabel = meta.status === "present" ? "출석" : meta.status === "absent" ? "결석" : "예정";
  const statusStyle = getStatusStyle(meta.status ?? "planned");

  const togglePresent = () => {
    if (!canEdit) return;
    upsertMeta(token, index, { status: isPresent ? "planned" : "present" });
  };

  const toggleAbsent = () => {
    if (!canEdit) return;

    // 이미 결석이면 해제
    if (isAbsent) {
      upsertMeta(token, index, { status: "planned" });
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
    if (!iso) return ymdTodayLocal();
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
          extensionPaymentDate: record.extensionPaymentDate ?? ymdTodayLocal(),
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
      extensionPaymentDate: ymdTodayLocal(),
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

  const saveConsultRecord = () => {
    if (!student) return;
    const list = loadConsultationsByStudent(student.id);
    const err = validateConsultForm(consultForm, isAdmin);
    if (err) return setConsultError(err);
    const { updated } = buildConsultationRecord({
      records: list,
      editingId: consultEditingId,
      form: consultForm,
      nowIso: new Date().toISOString(),
      makeId: () => Math.random().toString(36).slice(2),
    });
    saveConsultationsByStudent(student.id, updated);
    setConsultOpen(false);

    if (isAdmin && consultForm.purpose === "pause_request") {
      if (consultForm.finalResult === "pause_confirm" && consultForm.pauseEffectiveDate) {
        const today = ymdTodayLocal();
        const pauseStatus = computePauseLifecycle(today, consultForm.pauseEffectiveDate) === "paused" ? "paused" : "confirmed";
        upsertStudent({
          ...student,
          status: "paused",
          pauseEffectiveDate: consultForm.pauseEffectiveDate,
          pauseStatus,
        });
      } else if (consultForm.finalResult === "pause_cancel") {
        upsertStudent({
          ...student,
          status: "active",
          pauseEffectiveDate: undefined,
          pauseStatus: "none",
        });
      }
    }
  };

  const deleteConsultRecord = () => {
    if (!student || !consultEditingId) return;
    const list = loadConsultationsByStudent(student.id);
    const updated = list.filter((r) => r.id !== consultEditingId);
    saveConsultationsByStudent(student.id, updated);
    setConsultOpen(false);
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
    setDraftOverrideDate((prev) => (prev ? prev : ymdTodayLocal()));
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

    setOpen(false);
  };

  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 10,
        padding: "8px 10px",
        background: "#fff",
      }}
      className="flex items-center justify-between gap-3"
    >
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
          <Badge style={{ background: statusStyle.bg, color: statusStyle.text }}>{statusLabel}</Badge>
          <Badge style={{ background: achievementColor, color: "#fff" }}>{achievementPercent}%</Badge>
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
      {canEdit && (
        <div className="flex items-center gap-2">
          <button className={`rounded border ${isPresent ? "btn btn-blue" : "btn"}`} onClick={togglePresent}>
            출석
          </button>

          <button className={`rounded border ${isAbsent ? "btn btn-red" : "btn"}`} onClick={toggleAbsent}>
            결석
          </button>

          <button
            className="rounded border border-neutral-300 bg-transparent btn btn-bold"
            onClick={openAdjustModal}
          >
            조정
          </button>

          <ConsultButton tag={consultTag} onClick={openConsultModal} />
        </div>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded bg-white p-4 shadow">
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

                <div className="text-xs text-neutral-500">• 같은 버튼을 한 번 더 누르면 해제됩니다.</div>
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

              {/* 사유/기록 */}
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

      <ConsultModal
        open={consultOpen}
        role={role}
        state={consultForm}
        error={consultError}
        onChange={setConsultForm}
        onClose={() => setConsultOpen(false)}
        onSave={saveConsultRecord}
        onDelete={consultEditingId ? deleteConsultRecord : undefined}
      />
    </div>
  );
}
