// app/t/tmain/TeacherMainClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Student, Teacher } from "@/lib/types/index";
import { loadStudents } from "@/lib/storage/students";
import { sessionsByStudent } from "@/lib/storage/sessions";
import { loadConsultationsByStudent } from "@/lib/storage/consultations";
import {
  loadTeachers,
  loadCurrentTeacherId,
  TEACHERS_EVENT,
} from "@/lib/storage/teachers";
import TodaySessionsCard, { type TodaySessionRow } from "@/lib/ui/teacher/TodaySessionsCard";
import TeacherStudentListCard from "@/lib/ui/teacher/TeacherStudentListCard";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import {
  buildBaseDatesISOByToken,
  computeEffectiveISO,
  getDdayMeta,
  readMetaMap,
} from "@/lib/factories/sessionFactories";
import { computeStudentStatus } from "@/lib/factories/studentStatusFactory";
import { GATE_EVENT } from "@/lib/ui/common/roleGateStorage";
import { buildConsultationMap, pickPrimaryConsultTag } from "@/lib/ui/session/consultationMap";
import { findLastClassIndex } from "@/lib/ui/session/pauseHelpers";

function parseDateTime(iso: string | null | undefined) {
  if (!iso) return { dateText: "날짜 없음", timeText: "-" };
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return { dateText: "날짜 없음", timeText: "-" };

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);

  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return { dateText: `${y}. ${m}. ${d}.`, timeText: `${hh}시 ${mm}분` };
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isPausedOrOverdueExtension(st: Student) {
  const status = computeStudentStatus(st);
  return status === "paused" || status === "overdue_extension";
}

export default function TeacherMainClient({ initialRole = "t" }: { initialRole?: "a" | "t" }) {
  const router = useRouter();

  const [students, setStudents] = useState<Student[]>(() => loadStudents());
  const [teachers, setTeachers] = useState<Teacher[]>(() => loadTeachers());

  const [isHydrated, setIsHydrated] = useState(false);
  const [teacherId, setTeacherId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setStudents(loadStudents());
      setTeachers(loadTeachers());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => {
      setIsHydrated(true);
      setTeacherId(loadCurrentTeacherId());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const onGate = () => {
      setStudents(loadStudents());
      setTeachers(loadTeachers());
      setTeacherId(loadCurrentTeacherId());
    };
    window.addEventListener(GATE_EVENT, onGate);
    window.addEventListener("tutorweb:studentsUpdated", onGate);
    window.addEventListener(TEACHERS_EVENT, onGate);
    return () => {
      window.removeEventListener(GATE_EVENT, onGate);
      window.removeEventListener("tutorweb:studentsUpdated", onGate);
      window.removeEventListener(TEACHERS_EVENT, onGate);
    };
  }, []);

  const hasTeacher = isHydrated && !!teacherId;

  const currentTeacherName = useMemo(() => {
    if (!hasTeacher) return "";
    return teachers.find((t) => t.id === teacherId)?.name ?? `알 수 없음(${teacherId})`;
  }, [hasTeacher, teachers, teacherId]);

  const visibleStudents = useMemo(() => {
    if (!hasTeacher) return [];
    return students.filter((s) => (s.teacherId ?? null) === teacherId && !isPausedOrOverdueExtension(s));
  }, [hasTeacher, students, teacherId]);

  const todayRows = useMemo<TodaySessionRow[]>(() => {
    if (!isHydrated) return [];
    const now = new Date();
    const rows: TodaySessionRow[] = [];

    for (const st of visibleStudents) {
      if (!st.token) continue;
      const baseDatesISO = buildBaseDatesISOByToken(st.token, 60);
      const metaMap = readMetaMap(st.token);
      const sessions = sessionsByStudent(st.id);
      const consultRecords = loadConsultationsByStudent(st.id);
      const consultMap = buildConsultationMap({
        token: st.token,
        sessions,
        baseDatesISO,
        metaMap,
        records: consultRecords,
      });
      const lastClassIndex =
        (st.pauseStatus === "confirmed" || st.pauseStatus === "paused") && st.pauseEffectiveDate
          ? findLastClassIndex({
              token: st.token,
              sessions,
              baseDatesISO,
              metaMap,
              pauseEffectiveDate: st.pauseEffectiveDate,
            })
          : null;

      for (const s of sessions) {
        const { effectiveISO, meta } = computeEffectiveISO({
          token: st.token,
          index: s.index,
          baseDatesISO,
          metaMap,
        });
        const dday = getDdayMeta(effectiveISO, now);
        if (dday.diff !== 0) continue;

        const { dateText, timeText } = parseDateTime(effectiveISO);

        const baseKey = `mk3:${st.token}:session:${s.index}`;
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
        const percent = total === 0 ? 0 : Math.round((done / total) * 100);

        rows.push({
          studentId: st.id,
          token: st.token,
          studentName: st.name,
          index: s.index,
          effectiveISO: effectiveISO ?? "",
          dateText,
          timeText,
          status: meta.status ?? "planned",
          ddayLabel: dday.label,
          ddayClass: dday.className,
          percent,
          consultTag: pickPrimaryConsultTag(consultMap[s.index]),
          lastClass: lastClassIndex ? s.index === lastClassIndex : false,
        });
      }
    }

    return rows.sort((a, b) => {
      const timeCmp = a.effectiveISO.localeCompare(b.effectiveISO);
      if (timeCmp !== 0) return timeCmp;
      return a.studentName.localeCompare(b.studentName, "ko");
    });
  }, [visibleStudents, isHydrated]);

  if (!isHydrated) {
    return (
      <main className="p-6" style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 className="page-title">선생님 화면</h1>
        <p className="mt-2 text-sm opacity-70">로딩 중...</p>
      </main>
    );
  }

  return (
    <main className="p-6">
      <div style={{ marginBottom: 12 }}>
        <RoleGateCard
          role={initialRole}
          teachers={teachers}
          students={students}
          teacherId={teacherId}
          studentToken={null}
          onTeacherChange={(next) => setTeacherId(next)}
        />
        <div style={{ color: "#666", marginTop: 6 }}>
          teacherId 없는 상태에서는 학생을 표시하지 않습니다.
        </div>
      </div>

      {initialRole === "a" ? (
        <div style={{ marginBottom: 8 }}>
          <button className="btn btn-bold" onClick={() => router.push("/a/amain")}>
            관리자 페이지
          </button>
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "end",
          gap: 12,
        }}
      >
        <div />
        <div style={{ textAlign: "center" }}>
          <h1 className="page-title">{currentTeacherName ? `${currentTeacherName} · 학생 관리` : "학생 관리"}</h1>
        </div>
        <div />
      </div>

      <TodaySessionsCard rows={todayRows} role={initialRole} />

      {teacherId ? (
        <TeacherStudentListCard
          students={visibleStudents}
          role={initialRole}
          onAddStudent={() => router.push(`/${initialRole}/tmain/new`)}
        />
      ) : (
        <section
          style={{
            marginTop: 14,
            border: "1px solid #eee",
            borderRadius: 10,
            padding: 12,
            background: "#fff",
          }}
        >
          <div className="text-muted">선생님을 선택하면 학생 리스트가 표시됩니다.</div>
        </section>
      )}

    </main>
  );
}
