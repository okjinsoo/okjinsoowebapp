// v1/lib/ui/student/StudentNewClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Id, Student, Teacher, ScheduleRule, Weekday, Session } from "@/lib/types/index";
import { upsertStudent } from "@/lib/storage/students";
import { upsertSession } from "@/lib/storage/sessions";
import { makeId, makeToken } from "@/lib/utils/id";
import { nowIso, todayYmdLocal } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";

// cohort 자동 생성: "년도_랜덤6자리수"
function makeCohortId() {
  const year = new Date().getFullYear();
  const n = Math.floor(Math.random() * 1_000_000);
  const six = String(n).padStart(6, "0");
  return `${year}_${six}`;
}

function weekdayLabel(n: number) {
  return ["일", "월", "화", "수", "목", "금", "토"][n] ?? String(n);
}

function normalizeHour(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(23, Math.floor(n)));
}

function normalizeMinute(n: number): 0 | 30 {
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(0, Math.min(30, Math.floor(n)));
  return clamped >= 15 ? 30 : 0;
}

function normalizePlanCount(n: number) {
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(60, Math.floor(n)));
}

// 주 n회 규칙 기반으로 회차 날짜 생성 (startDate부터 2년 범위에서 후보 생성 → 앞에서 count개)
function generateSessionDates(startDateYmd: string, rules: ScheduleRule[], count: number): Date[] {
  const start = new Date(`${startDateYmd}T00:00:00`);
  if (isNaN(start.getTime())) return [];

  const candidates: Date[] = [];

  for (let dayOffset = 0; dayOffset < 365 * 2; dayOffset++) {
    const base = new Date(start);
    base.setDate(start.getDate() + dayOffset);

    const weekday = base.getDay();
    for (const r of rules) {
      if (r.weekday !== weekday) continue;
      const dt = new Date(base);
      dt.setHours(r.hour, r.minute, 0, 0);
      candidates.push(dt);
    }
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates.slice(0, count);
}

export type StudentNewMode = "admin" | "teacher";

type DayTime = { on: boolean; hour: number; minute: 0 | 30 };

export default function StudentNewClient(props: {
  mode: StudentNewMode;
  teachers: Teacher[];
  fixedTeacherId?: Id; // mode=teacher일 때 필수(권장)
  onDoneGoTo: string; // 생성 후 이동할 경로 (예: "/a/students" or "/t/students")
}) {
  const router = useRouter();
  const { mode, teachers, fixedTeacherId, onDoneGoTo } = props;

  // -------------------- form state --------------------
  const [teacherId, setTeacherId] = useState<string>(fixedTeacherId ?? "");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");

  const [googleEmail, setGoogleEmail] = useState("");

  const [studentPhone, setStudentPhone] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState(""); // "1".."12","N수"
  const [parentRole, setParentRole] = useState<"" | "father" | "mother">("");
  const [parentPhone, setParentPhone] = useState("");

  const [planCount, setPlanCount] = useState<number>(12);

  // 요일별 설정(최소 1개 on)
  const [days, setDays] = useState<Record<number, DayTime>>(() => {
    const init: Record<number, DayTime> = {};
    for (const d of [0, 1, 2, 3, 4, 5, 6]) init[d] = { on: false, hour: 17, minute: 0 };
    return init;
  });

  const [error, setError] = useState<string>("");

  const [startDate, setStartDate] = useState(() => todayYmdLocal());

  const gradeOptions = useMemo(() => {
    const out: Array<{ label: string; value: string }> = [];
    for (let i = 1; i <= 6; i++) out.push({ label: `초${i}`, value: String(i) });
    for (let i = 1; i <= 3; i++) out.push({ label: `중${i}`, value: String(i + 6) });
    for (let i = 1; i <= 3; i++) out.push({ label: `고${i}`, value: String(i + 9) });
    out.push({ label: "N수", value: "N수" });
    return out;
  }, []);

  const selectedRules = useMemo(() => {
    const rules: ScheduleRule[] = [];
    for (const d of [0, 1, 2, 3, 4, 5, 6]) {
      const it = days[d];
      if (!it?.on) continue;
      rules.push({ weekday: d as Weekday, hour: it.hour, minute: it.minute });
    }
    // 정렬(요일 → 시간)
    rules.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
    return rules;
  }, [days]);

  const teacherLabel = useMemo(() => {
    if (!teacherId) return "미선택";
    return teachers.find((t) => t.id === teacherId)?.name ?? teacherId;
  }, [teacherId, teachers]);

  function toggleDay(d: number) {
    setDays((prev) => ({ ...prev, [d]: { ...prev[d], on: !prev[d].on } }));
  }

  function setDayHour(d: number, hour: number) {
    setDays((prev) => ({ ...prev, [d]: { ...prev[d], hour: normalizeHour(hour) } }));
  }

  function setDayMinute(d: number, minute: 0 | 30) {
    setDays((prev) => ({ ...prev, [d]: { ...prev[d], minute: normalizeMinute(minute) } }));
  }

  function validate(): boolean {
    setError("");

    if (!teacherId) return fail("배정 선생님을 선택해주세요.");
    if (mode === "teacher" && fixedTeacherId && teacherId !== fixedTeacherId) {
      return fail("선생님 화면에서는 배정 선생님을 변경할 수 없습니다.");
    }

    if (!name.trim()) return fail("학생 이름을 입력해주세요.");

    const email = googleEmail.trim();
    if (!email) return fail("학생 Google e-mail을 입력해주세요.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("e-mail 형식이 올바르지 않습니다. 예: xx@yy.zz");
    }

    if (!normalizePhoneDigits(studentPhone)) return fail("학생 전화번호를 입력해주세요.");
    if (!school.trim()) return fail("학생 학교를 입력해주세요.");
    if (!grade) return fail("학년을 선택해주세요.");
    if (!normalizePhoneDigits(parentPhone)) return fail("학부모 전화번호를 입력해주세요.");

    if (selectedRules.length < 1) return fail("수업 시간(요일)을 최소 1개 이상 선택해주세요.");

    const pc = normalizePlanCount(planCount);
    if (pc < 1) return fail("회차 수를 확인해주세요.");

    return true;

    function fail(msg: string) {
      setError(msg);
      return false;
    }
  }

  function onSubmit() {
    if (!validate()) return;

    const pc = normalizePlanCount(planCount);
    const rules = selectedRules;

    const dates = generateSessionDates(startDate, rules, pc);
    if (dates.length !== pc) {
      setError("회차 날짜 생성에 실패했습니다. 요일/시간을 확인해주세요.");
      return;
    }

    const st: Student = {
      id: makeId(),
      token: makeToken(12),
      name: name.trim(),
      cohort: makeCohortId(),
      status: "active",
      createdAt: nowIso(),
      teacherId: teacherId,

      startDate,
      planCount: pc,
      scheduleRules: rules,

      googleEmail: googleEmail.trim(),
      studentPhone: normalizePhoneDigits(studentPhone),
      school: school.trim(),
      grade: grade,
      parentPhone: normalizePhoneDigits(parentPhone),

      gender: gender ? gender : undefined,
      parentRole: parentRole ? parentRole : undefined,

      paymentHistory: [],
      scheduleChangeEvents: [],
    };

    upsertStudent(st);

    // ✅ 생성과 동시에 회차(Session)도 생성(A안)
    for (let i = 0; i < pc; i++) {
      const sess: Session = {
        id: makeId(),
        studentId: st.id,
        index: i + 1,
        displayAt: dates[i].toISOString(),
        state: "normal",
        createdAt: nowIso(),
      };
      upsertSession(sess);
    }

    router.push(onDoneGoTo);
  }

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto"}}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">신규 학생 등록 ({mode === "admin" ? "원장" : "선생님"})</h1>
          <div style={{ color: "#666", marginTop: 6 }}>
            시작일을 선택할 수 있습니다. (기본값: 오늘)
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => router.push(onDoneGoTo)} style={{ padding: "8px 12px" }} title="목록으로 돌아가기">
            목록으로
          </button>
        </div>
      </div>

      <section style={{ marginTop: 14, display: "grid", gap: 14 }}>
        {/* start date */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">시작일</div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        {/* teacher */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">배정 선생님</div>

          {mode === "admin" ? (
            <select
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
              style={{
                width: "100%",
                height: 40,
                padding: 10,
                border: "1px solid #ccc",
                borderRadius: 8,
                marginTop: 8,
              }}
            >
              <option value="">선택하세요</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
              }}
            >
              <div style={{ }}>
                <b>{teacherLabel}</b>
              </div>
              <div style={{ color: "#666", marginTop: 4 }}>
                선생님 화면에서는 배정 선생님이 자동으로 고정됩니다.
              </div>
            </div>
          )}
        </div>

        {/* 학생 기본 */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">학생 정보</div>

          <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700}}>학생 이름 *</div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="예: 홍길동"
                  style={{
                    width: "100%",
                    height: 40,
                    padding: 10,
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    marginTop: 6,
                  }}
                />
              </div>
              <div>
                <div style={{ fontWeight: 700}}>학생 전화번호 *</div>
                <input
                  value={studentPhone}
                  onChange={(e) => setStudentPhone(e.target.value)}
                  placeholder="예: 010-1234-5678 (저장은 숫자만)"
                  style={{
                    width: "100%",
                    height: 40,
                    padding: 10,
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    marginTop: 6,
                  }}
                />
              </div>
            </div>

            <div style={{ color: "#666", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "inline-flex", alignItems: "center" }}>
                <input
                  type="radio"
                  checked={gender === "male"}
                  onChange={() => setGender("male")}
                  style={{ marginRight: 6, verticalAlign: "middle" }}
                />
                남
              </label>
              <label style={{ display: "inline-flex", alignItems: "center" }}>
                <input
                  type="radio"
                  checked={gender === "female"}
                  onChange={() => setGender("female")}
                  style={{ marginRight: 6, verticalAlign: "middle" }}
                />
                여
              </label>
              <label style={{ display: "inline-flex", alignItems: "center" }}>
                <input
                  type="radio"
                  checked={gender === ""}
                  onChange={() => setGender("")}
                  style={{ marginRight: 6, verticalAlign: "middle" }}
                />
                선택 안함
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700}}>학교 *</div>
                <input
                  value={school}
                  onChange={(e) => setSchool(e.target.value)}
                  placeholder="예: OO중학교"
                  style={{
                    width: "100%",
                    height: 40,
                    padding: 10,
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    marginTop: 6,
                  }}
                />
              </div>

              <div>
                <div style={{ fontWeight: 700}}>학년 *</div>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  style={{
                    width: "100%",
                    height: 40,
                    padding: 10,
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    marginTop: 6,
                  }}
                >
                  <option value="">선택하세요</option>
                  {gradeOptions.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                  </select>
                </div>
            </div>

            <div>
              <div style={{ fontWeight: 700}}>학생 Google e-mail *</div>
              <input
                value={googleEmail}
                onChange={(e) => setGoogleEmail(e.target.value)}
                placeholder="예: xx@yy.zz"
                style={{
                  width: "100%",
                  height: 44,
                  padding: 10,
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  marginTop: 6,
                }}
              />
              <div style={{ color: "#666", marginTop: 6 }}>
                저장 값: <code>{googleEmail.trim() || "입력 필요"}</code>
              </div>
            </div>

            <div style={{ borderTop: "1px dashed #ddd", paddingTop: 10 }}>
              <div className="card-title">학부모 연락처</div>

              <div style={{ marginTop: 8 }}>
                <div style={{ fontWeight: 700}}>학부모 전화번호 *</div>
                <input
                  value={parentPhone}
                  onChange={(e) => setParentPhone(e.target.value)}
                  placeholder="예: 010-0000-0000 (저장은 숫자만)"
                  style={{
                    width: "100%",
                    height: 40,
                    padding: 10,
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    marginTop: 6,
                  }}
                />
                <div style={{ color: "#666", marginTop: 6, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <label style={{ display: "inline-flex", alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={parentRole === "father"}
                      onChange={() => setParentRole("father")}
                      style={{ marginRight: 6, verticalAlign: "middle" }}
                    />
                    부
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={parentRole === "mother"}
                      onChange={() => setParentRole("mother")}
                      style={{ marginRight: 6, verticalAlign: "middle" }}
                    />
                    모
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={parentRole === ""}
                      onChange={() => setParentRole("")}
                      style={{ marginRight: 6, verticalAlign: "middle" }}
                    />
                    선택 안함
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 수업 시간 */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">수업 시간 설정 *</div>
          <div style={{ marginTop: 6, color: "#666" }}>
            요일을 최소 1개 이상 선택하세요. 선택한 요일마다 시/분(00, 30)을 설정합니다.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const on = days[d]?.on;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 999,
                    border: "1px solid #ccc",
                    background: on ? "#111" : "#fff",
                    color: on ? "#fff" : "#111",
                  }}
                  aria-pressed={on}
                >
                  {weekdayLabel(d)}
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {[0, 1, 2, 3, 4, 5, 6]
              .filter((d) => days[d]?.on)
              .map((d) => (
                <div key={d} style={{ padding: 10, border: "1px solid #eee", borderRadius: 10, background: "#fff" }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px, 50%) 1fr 1fr",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ fontWeight: 800 }}>{weekdayLabel(d)}요일</div>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      step={1}
                      value={days[d].hour}
                      onChange={(e) => setDayHour(d, Number(e.target.value))}
                      style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 8, minWidth: 80 }}
                    />

                    <input
                      type="number"
                      min={0}
                      max={30}
                      step={30}
                      value={days[d].minute}
                      onChange={(e) => {
                        setDayMinute(d, normalizeMinute(Number(e.target.value)));
                      }}
                      style={{ width: "100%", padding: 10, border: "1px solid #ccc", borderRadius: 8, minWidth: 80 }}
                    />
                  </div>
                </div>
              ))}

            {[0, 1, 2, 3, 4, 5, 6].every((d) => !days[d]?.on) ? (
              <div style={{ color: "#666"}}>선택된 요일이 없습니다.</div>
            ) : null}
          </div>
        </div>

        {/* 회차 수 */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">회차 수 *</div>
          <input
            type="number"
            min={1}
            max={60}
            value={planCount}
            onChange={(e) => setPlanCount(Number(e.target.value))}
            style={{
              width: "100%",
              height: 40,
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              marginTop: 8,
            }}
          />
          <div style={{ marginTop: 6, color: "#666" }}>
            기본 12회 (1~60 범위). 생성과 동시에 회차가 자동 생성됩니다.
          </div>
        </div>

        {error ? <div style={{ color: "crimson", fontWeight: 700}}>{error}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => router.push(onDoneGoTo)} style={{ padding: "10px 14px" }}>
            취소
          </button>
          <button onClick={onSubmit} style={{ padding: "10px 14px", fontWeight: 800 }}>
            생성
          </button>
        </div>
      </section>
    </main>
  );
}
