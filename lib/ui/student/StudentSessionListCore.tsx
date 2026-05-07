"use client";

import { BROWSER_STORAGE_EVENT } from "@/lib/storage/browserStorage";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  buildBaseDatesISO,
  computeEffectiveISO,
  buildBadges,
} from "@/lib/factories/sessionFactories";
import { useMetaMap, getDdayMeta } from "@/lib/factories/sessionFactories";
import { buildDisplayRecords } from "@/lib/factories/lessonStatusFactory";
import Badge from "@/lib/ui/common/Badge";
import SessionCardRow from "@/lib/ui/session/SessionCardRow";
import SessionQuickActions from "@/lib/ui/session/SessionQuickActions";
import { buildSessionContextBadges } from "@/lib/ui/common/sessionExtraBadge";
import {
  calculateSessionProgressSummary,
  isSessionProgressEventKeyForToken,
} from "@/lib/factories/sessionProgressFactory";
import { parseDateTime } from "@/lib/ui/session/format";
import { useStudentSessionContext } from "@/lib/hooks/useStudentSessionContext";
import {
  buildSessionCardViewModel,
  resolveDurationMinForSessionWithMeta,
  resolveRulesForIndex,
} from "@/lib/ui/session/sessionCardFactory";

type Props = {
  role: "a" | "t" | "s";
  token: string;
  prefix: string;
  hideTokenInRoute?: boolean;
};

export default function StudentSessionListCore({ role, token, prefix, hideTokenInRoute = false }: Props) {
  const router = useRouter();
  const canUseQuickActions = role !== "s";
  const [mounted, setMounted] = useState(false);
  const [progressTick, setProgressTick] = useState(0);

  // ✅ metaMap 배선 단일화
  const metaMap = useMetaMap(token);
  const {
    student,
    sessions,
  } = useStudentSessionContext(token);
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onProgressChanged: EventListener = (event) => {
      const ce = event as CustomEvent<{ key?: string | null }>;
      const key = ce.detail?.key ?? "";
      if (!key) return;
      if (!isSessionProgressEventKeyForToken(key, token)) return;
      setProgressTick((x) => x + 1);
    };
    window.addEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);
    return () => {
      window.removeEventListener(BROWSER_STORAGE_EVENT, onProgressChanged);
    };
  }, [token]);



  // baseDates는 규칙 기반이라 자주 변하지 않음(토큰 기준)
  const baseDatesISO = useMemo(() => (student ? buildBaseDatesISO(student, 60) : []), [student]);

  const progressByIndex = useMemo(() => {
    if (!mounted) return {} as Record<number, { done: number; total: number; percent: number | null }>;
    void progressTick;
    const out: Record<number, { done: number; total: number; percent: number | null }> = {};
    for (const s of sessions) {
      out[s.index] = calculateSessionProgressSummary({
        token,
        sessionIndex: s.index,
      });
    }
    return out;
  }, [mounted, token, sessions, progressTick]);

  const refundCompletedIndex = useMemo(() => {
    if (!student) return null;
    const history = student.paymentHistory ?? [];
    const displayRecords = buildDisplayRecords(student, history).displayRecords;
    const indices = displayRecords
      .filter((r) => r.refundStatus === "completed" && Number.isFinite(r.refundSessionIndex))
      .map((r) => Number(r.refundSessionIndex));
    if (indices.length === 0) return null;
    return Math.min(...indices);
  }, [student]);
  const refundRequestedIndex = useMemo(() => {
    if (!student) return null;
    const history = student.paymentHistory ?? [];
    const displayRecords = buildDisplayRecords(student, history).displayRecords;
    const indices = displayRecords
      .filter((r) => r.refundStatus === "requested" && Number.isFinite(r.refundSessionIndex))
      .map((r) => Number(r.refundSessionIndex));
    if (indices.length === 0) return null;
    return Math.min(...indices);
  }, [student]);

  const rows = useMemo(() => {
    if (!student) return [];
    const lastClassIndex = null;

    return sessions
      .map((s) => {
        const { effectiveISO, meta } = computeEffectiveISO({
          token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });

        const rules = resolveRulesForIndex(student, s.index);
        const durationMin = resolveDurationMinForSessionWithMeta(effectiveISO, rules, meta);
        const { dateText, timeText } = parseDateTime(effectiveISO, durationMin);
        const badges = buildSessionContextBadges({
          baseBadges: buildBadges(meta),
          lastClass: Boolean(lastClassIndex && s.index === lastClassIndex),
          refundStatus:
            refundCompletedIndex && s.index === refundCompletedIndex
              ? "completed"
              : refundRequestedIndex && s.index === refundRequestedIndex
                ? "requested"
                : null,
        });

        // ✅ D-day 레고: mounted 이전에는 diff를 만들지 않음(SSR mismatch 방지)
        const dday = mounted ? getDdayMeta(effectiveISO, new Date()) : null;
        const progress = progressByIndex[s.index] ?? { done: 0, total: 0, percent: 0 };

        return {
          index: s.index,
          effectiveISO: effectiveISO ?? "",
          dateText,
          timeText,
          status: meta.status ?? "planned",
          badges,
          dday, // { diff, label, className } | null
          progress,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [student, token, baseDatesISO, metaMap, mounted, sessions, progressByIndex, refundCompletedIndex, refundRequestedIndex]);

  const { upcomingRows, pastRows } = useMemo(() => {
    const upcoming: typeof rows = [];
    const past: typeof rows = [];

    for (const r of rows) {
      if (refundCompletedIndex && r.index > refundCompletedIndex && r.dday && r.dday.diff !== null && r.dday.diff >= 0) {
        continue;
      }
      const diff = r.dday?.diff;
      if (diff === null || diff === undefined) {
        upcoming.push(r);
        continue;
      }
      if (diff >= 0) upcoming.push(r);
      else past.push(r);
    }

    return { upcomingRows: upcoming, pastRows: past };
  }, [rows, refundCompletedIndex]);

  const pastDesc = useMemo(() => [...pastRows].sort((a, b) => b.index - a.index), [pastRows]);
  const visibleUpcoming = showAllUpcoming ? upcomingRows : upcomingRows.slice(0, 3);
  const visiblePast = showAllPast ? pastDesc : pastDesc.slice(0, 5);

  if (!mounted) return null;

  return (
    <div className="space-y-3 p-4">
      <div style={{ textAlign: "center" }}>
        <div className="text-base font-normal">
          <span className="page-title">{student ? student.name : "학생"} 수업 목록</span>
        </div>
      </div>

      <div className="space-y-5">
        <div
          className="space-y-2 rounded-xl border p-3"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
        >
          <div className="card-title">예정 수업</div>
          {upcomingRows.length === 0 ? (
            <div className="text-muted">예정된 수업이 없습니다.</div>
          ) : null}
          {visibleUpcoming.map((r) => {
            const href = hideTokenInRoute ? `${prefix}/session/${r.index}` : `${prefix}/${token}/session/${r.index}`;
            const model = buildSessionCardViewModel({
              index: r.index,
              dateTimeText: `${r.dateText} ${r.timeText}`.trim(),
              dday: r.dday,
              status: r.status as "present" | "absent" | "planned",
              achievementPercent: r.progress.percent,
              extraBadges: r.badges,
              hiddenBadgeLabels: ["마지막 수업"],
            });
            return (
              <SessionCardRow
                key={`upcoming-${r.index}`}
                model={model}
                onClick={() => router.push(href)}
                inlineBadgeSlot={
                  <>
                    {r.badges.includes("마지막 수업") ? (
                      <Badge style={{ background: "#ef4444", color: "#fff" }}>마지막 수업</Badge>
                    ) : null}
                  </>
                }
                rightSlot={
                  canUseQuickActions ? (
                    <SessionQuickActions role={role} token={token} index={r.index} />
                  ) : null
                }
              />
            );
          })}
          {upcomingRows.length > 3 ? (
            <button
              onClick={() => setShowAllUpcoming((prev) => !prev)}
              className="block w-full rounded-xl border p-3 text-sm font-semibold"
              style={{
                borderColor: "var(--surface-border)",
                background: "var(--surface-bg)",
                color: "var(--text-subtle)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
            >
              {showAllUpcoming ? "접기" : "펼치기"}
            </button>
          ) : null}
        </div>

        <div
          className="space-y-2 rounded-xl border p-3"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-bg)" }}
        >
          <div className="card-title">지난 수업</div>
          {pastRows.length === 0 ? (
            <div className="text-muted">지난 수업이 없습니다.</div>
          ) : null}
          {visiblePast.map((r) => {
            const href = hideTokenInRoute ? `${prefix}/session/${r.index}` : `${prefix}/${token}/session/${r.index}`;
            const model = buildSessionCardViewModel({
              index: r.index,
              dateTimeText: `${r.dateText} ${r.timeText}`.trim(),
              dday: r.dday,
              status: r.status as "present" | "absent" | "planned",
              achievementPercent: r.progress.percent,
              extraBadges: r.badges,
              hiddenBadgeLabels: ["마지막 수업"],
            });
            return (
              <SessionCardRow
                key={`past-${r.index}`}
                model={model}
                onClick={() => router.push(href)}
                rightSlot={
                  canUseQuickActions ? (
                    <SessionQuickActions role={role} token={token} index={r.index} />
                  ) : null
                }
              />
            );
          })}
          {pastDesc.length > 5 ? (
            <button
              onClick={() => setShowAllPast((prev) => !prev)}
              className="block w-full rounded-xl border p-3 text-sm font-semibold"
              style={{
                borderColor: "var(--surface-border)",
                background: "var(--surface-bg)",
                color: "var(--text-subtle)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "var(--surface-bg)")}
            >
              {showAllPast ? "접기" : "펼치기"}
            </button>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <div className="text-muted">회차가 없습니다.</div>
        ) : null}
      </div>

    </div>
  );
}
