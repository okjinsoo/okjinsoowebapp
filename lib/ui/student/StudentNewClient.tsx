// v1/lib/ui/student/StudentNewClient.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Id, Student, Teacher, ScheduleRule, Weekday } from "@/lib/types/index";
import { saveStudents } from "@/lib/storage/students";
import { pushSharedSnapshot } from "@/lib/storage/sharedSnapshot";
import { loadLatestCoreSnapshotBaselineServerRequired } from "@/lib/storage/safeSnapshotMerge";
import { makeId, makeToken } from "@/lib/utils/id";
import { nowIso, todayYmdLocal } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";
import { SERVER_SAVE_RETRY_MESSAGE } from "@/lib/messages/serverMessages";

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

function normalizeWeeklyCount(n: number) {
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(7, Math.floor(n)));
}

function normalizeDurationHour(n: number): number {
  if (!Number.isFinite(n)) return 1;
  const clamped = Math.max(0.5, Math.min(6, n));
  return Math.round(clamped * 2) / 2;
}

function normalizeMinute(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Number(n) >= 30 ? 30 : 0;
}

export type StudentNewMode = "admin" | "teacher";

type InitialSessionBox = {
  weekday: Weekday;
  hour: number;
  minute: number;
  durationHour: number;
};

type SheetPasteFields = {
  startDate?: string;
  name?: string;
  studentPhone?: string;
  school?: string;
  grade?: string;
  googleEmail?: string;
  parentPhone?: string;
};

type SheetPair = {
  label: string;
  value: string;
};

function normalizeSheetKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()\-_:./]/g, "");
}

function resolveSheetFieldKey(rawLabel: string): keyof SheetPasteFields | null {
  const key = normalizeSheetKey(rawLabel);
  if (!key) return null;

  if (key === "시작일") return "startDate";
  if (key === "학생이름") return "name";
  if (key === "학생전화번호" || key === "학생연락처" || key === "학생핸드폰") return "studentPhone";
  if (key === "학교") return "school";
  if (key === "학년") return "grade";
  if (
    key === "학생구글이메일" ||
    key === "학생googleemail" ||
    key === "학생이메일" ||
    key === "학생email"
  ) {
    return "googleEmail";
  }
  if (key === "학부모연락처" || key === "학부모전화번호" || key === "학부모핸드폰") return "parentPhone";
  return null;
}

function parseSheetDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dotted = raw.match(/^(\d{4})[./\s년]+(\d{1,2})[./\s월]+(\d{1,2})/);
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const match = ymd ?? dotted ?? slash;
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSheetGrade(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const compact = raw.replace(/\s+/g, "");

  if (/^n수$/i.test(compact)) return "N수";

  const num = Number(compact);
  if (Number.isFinite(num)) {
    if (num >= 20) return "N수";
    const map: Record<number, string> = {
      19: "12",
      18: "11",
      17: "10",
      16: "9",
      15: "8",
      14: "7",
      13: "6",
      12: "5",
      11: "4",
      10: "3",
      9: "2",
      8: "1",
    };
    return map[Math.floor(num)] ?? null;
  }

  const high = compact.match(/^고([123])$/);
  if (high) return String(Number(high[1]) + 9);

  const middle = compact.match(/^중([123])$/);
  if (middle) return String(Number(middle[1]) + 6);

  const elem = compact.match(/^초([1-6])$/);
  if (elem) return String(Number(elem[1]));

  return null;
}

function extractFieldsFromPairs(pairs: SheetPair[]): { fields: SheetPasteFields; recognizedCount: number } {
  const fields: SheetPasteFields = {};
  let recognizedCount = 0;

  for (const pair of pairs) {
    const fieldKey = resolveSheetFieldKey(pair.label);
    if (!fieldKey) continue;

    const value = pair.value.trim();
    if (!value) continue;
    recognizedCount += 1;

    if (fieldKey === "startDate") {
      const parsed = parseSheetDate(value);
      if (parsed) fields.startDate = parsed;
      continue;
    }
    if (fieldKey === "grade") {
      const parsed = parseSheetGrade(value);
      if (parsed) fields.grade = parsed;
      continue;
    }
    if (fieldKey === "studentPhone") {
      fields.studentPhone = normalizePhoneDigits(value);
      continue;
    }
    if (fieldKey === "parentPhone") {
      fields.parentPhone = normalizePhoneDigits(value);
      continue;
    }
    fields[fieldKey] = value;
  }

  return { fields, recognizedCount };
}

function parseSheetPaste(rawInput: string): { fields: SheetPasteFields; recognizedCount: number } {
  const lines = rawInput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { fields: {}, recognizedCount: 0 };
  }

  let best: { fields: SheetPasteFields; recognizedCount: number } = {
    fields: {},
    recognizedCount: 0,
  };

  const verticalPairs: SheetPair[] = [];
  for (const line of lines) {
    const tabIndex = line.indexOf("\t");
    if (tabIndex < 0) continue;
    const label = line.slice(0, tabIndex).trim();
    const value = line.slice(tabIndex + 1).trim();
    if (!label || !value) continue;
    verticalPairs.push({ label, value });
  }
  if (verticalPairs.length > 0) {
    const verticalResult = extractFieldsFromPairs(verticalPairs);
    if (verticalResult.recognizedCount > best.recognizedCount) {
      best = verticalResult;
    }
  }

  if (lines.length >= 2 && lines[0].includes("\t")) {
    const headers = lines[0].split("\t").map((v) => v.trim());
    const values = lines[1].split("\t").map((v) => v.trim());
    const horizontalPairs: SheetPair[] = headers.map((label, index) => ({
      label,
      value: values[index] ?? "",
    }));
    const horizontalResult = extractFieldsFromPairs(horizontalPairs);
    if (horizontalResult.recognizedCount > best.recognizedCount) {
      best = horizontalResult;
    }
  }

  return best;
}

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

  const [initialWeeklyCount, setInitialWeeklyCount] = useState<number>(1);
  const [initialBoxes, setInitialBoxes] = useState<InitialSessionBox[]>([
    { weekday: 1, hour: 17, minute: 0, durationHour: 1 },
  ]);

  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [sheetModalOpen, setSheetModalOpen] = useState(false);
  const [sheetRawInput, setSheetRawInput] = useState("");
  const [sheetModalError, setSheetModalError] = useState("");
  const [sheetApplyInfo, setSheetApplyInfo] = useState("");

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
    const weeklyCount = normalizeWeeklyCount(initialWeeklyCount);
    const rules = initialBoxes
      .slice(0, weeklyCount)
      .map((box) => ({
        weekday: box.weekday,
        hour: normalizeHour(box.hour),
        minute: normalizeMinute(box.minute),
        durationMin: Math.max(30, Math.round(normalizeDurationHour(box.durationHour) * 60)),
      }));
    rules.sort((a, b) => a.weekday - b.weekday || a.hour - b.hour || a.minute - b.minute);
    return rules as ScheduleRule[];
  }, [initialBoxes, initialWeeklyCount]);

  const teacherLabel = useMemo(() => {
    if (!teacherId) return "미선택";
    return teachers.find((t) => t.id === teacherId)?.name ?? teacherId;
  }, [teacherId, teachers]);

  function setWeeklyCount(nextRawCount: number) {
    const nextCount = normalizeWeeklyCount(nextRawCount);
    setInitialWeeklyCount(nextCount);
    setInitialBoxes((prev) => {
      const source = prev.length > 0 ? prev : [{ weekday: 1, hour: 17, minute: 0, durationHour: 1 }];
      const next: InitialSessionBox[] = [];
      for (let i = 0; i < nextCount; i++) {
        const picked = prev[i] ?? source[i % source.length];
        const weekday = Math.max(0, Math.min(6, Math.floor(Number(picked.weekday) || 0))) as Weekday;
        next.push({
          weekday,
          hour: normalizeHour(Number(picked.hour)),
          minute: normalizeMinute(Number(picked.minute ?? 0)),
          durationHour: normalizeDurationHour(Number(picked.durationHour)),
        });
      }
      return next;
    });
  }

  function updateInitialBox(index: number, patch: Partial<InitialSessionBox>) {
    setInitialBoxes((prev) =>
      prev.map((box, i) => {
        if (i !== index) return box;
        return {
          weekday:
            patch.weekday === undefined
              ? box.weekday
              : (Math.max(0, Math.min(6, Math.floor(Number(patch.weekday)))) as Weekday),
          hour: patch.hour === undefined ? box.hour : normalizeHour(Number(patch.hour)),
          minute: patch.minute === undefined ? box.minute : normalizeMinute(Number(patch.minute)),
          durationHour:
            patch.durationHour === undefined ? box.durationHour : normalizeDurationHour(Number(patch.durationHour)),
        };
      })
    );
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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return fail("시작일을 입력해주세요.");
    const startDateMs = new Date(`${startDate}T00:00:00+09:00`).getTime();
    if (!Number.isFinite(startDateMs)) return fail("시작일 형식이 올바르지 않습니다.");
    if (selectedRules.length < 1) return fail("초기 회차 설정을 최소 1개 이상 입력해주세요.");

    const pc = selectedRules.length;
    if (pc < 1) return fail("초기 회차 수를 계산하지 못했습니다.");

    return true;

    function fail(msg: string) {
      setError(msg);
      return false;
    }
  }

  async function onSubmit() {
    if (!validate()) return;

    const pc = selectedRules.length;
    const rules = selectedRules;

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

    setSaving(true);
    try {
      const baseline = await loadLatestCoreSnapshotBaselineServerRequired();
      const baseStudents = baseline.students;
      const baseSessions = baseline.sessions;

      const nextStudents = [...baseStudents, st];

      await pushSharedSnapshot({
        students: nextStudents,
        sessions: baseSessions, // 신규 세션 추가 없이 학생만 추가
      });
      saveStudents(nextStudents, { skipSharedSnapshot: true });
      router.push(onDoneGoTo);
    } catch (err) {
      console.error("학생 생성 서버 저장 실패:", err);
      setError(SERVER_SAVE_RETRY_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  function onApplySheetInput() {
    setSheetModalError("");

    const parsed = parseSheetPaste(sheetRawInput);
    if (parsed.recognizedCount === 0) {
      setSheetModalError("인식된 항목이 없습니다. 시트에서 복사한 값을 다시 확인해주세요.");
      return;
    }

    let appliedCount = 0;
    if (parsed.fields.startDate) {
      setStartDate(parsed.fields.startDate);
      appliedCount += 1;
    }
    if (parsed.fields.name) {
      setName(parsed.fields.name);
      appliedCount += 1;
    }
    if (parsed.fields.studentPhone) {
      setStudentPhone(parsed.fields.studentPhone);
      appliedCount += 1;
    }
    if (parsed.fields.school) {
      setSchool(parsed.fields.school);
      appliedCount += 1;
    }
    if (parsed.fields.grade) {
      setGrade(parsed.fields.grade);
      appliedCount += 1;
    }
    if (parsed.fields.googleEmail) {
      setGoogleEmail(parsed.fields.googleEmail);
      appliedCount += 1;
    }
    if (parsed.fields.parentPhone) {
      setParentPhone(parsed.fields.parentPhone);
      appliedCount += 1;
    }

    if (appliedCount === 0) {
      setSheetModalError("붙여넣기 형식은 맞지만 반영할 값이 없습니다.");
      return;
    }

    setSheetApplyInfo(`시트값 ${appliedCount}개를 자동 입력했습니다.`);
    setSheetRawInput("");
    setSheetModalOpen(false);
  }

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto"}}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">신규 학생 등록 ({mode === "admin" ? "원장" : "선생님"})</h1>
          <div style={{ color: "var(--text-muted)", marginTop: 6 }}>
            시작일을 선택할 수 있습니다. (기본값: 오늘)
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => {
              setSheetModalError("");
              setSheetModalOpen(true);
            }}
            style={{ padding: "8px 12px" }}
            disabled={saving}
          >
            시트값 입력
          </button>
          <button
            onClick={() => router.push(onDoneGoTo)}
            style={{ padding: "8px 12px" }}
            title="목록으로 돌아가기"
            disabled={saving}
          >
            목록으로
          </button>
        </div>
      </div>

      {sheetApplyInfo ? (
        <div
          style={{
            marginTop: 10,
            borderRadius: 8,
            border: "1px solid #bfdbfe",
            background: "#eff6ff",
            color: "#1d4ed8",
            padding: "8px 10px",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          {sheetApplyInfo}
        </div>
      ) : null}

      <section style={{ marginTop: 14, display: "grid", gap: 14 }}>
        {/* start date */}
        <div style={{ border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
          <div className="card-title">시작일</div>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        {/* teacher */}
        <div style={{ border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
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
                background: "var(--surface-bg)",
              }}
            >
              <div style={{ }}>
                <b>{teacherLabel}</b>
              </div>
              <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                선생님 화면에서는 배정 선생님이 자동으로 고정됩니다.
              </div>
            </div>
          )}
        </div>

        {/* 학생 기본 */}
        <div style={{ border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
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

            <div style={{ color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
              <div style={{ color: "var(--text-muted)", marginTop: 6 }}>
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
                <div style={{ color: "var(--text-muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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

        {/* 초기 회차 설정 */}
        <div style={{ border: "1px solid var(--surface-border)", borderRadius: 10, padding: 12, background: "var(--surface-bg)" }}>
          <div className="card-title">초기 회차 설정 *</div>
          <div style={{ marginTop: 6, color: "var(--text-muted)" }}>
            주당 횟수만큼 박스를 채우면, 생성 시 1주치 회차가 자동 계산됩니다.
          </div>

          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>주당 횟수</div>
            <input
              type="number"
              min={1}
              max={7}
              value={initialWeeklyCount}
              onChange={(e) => setWeeklyCount(Number(e.target.value))}
              style={{
                width: "100%",
                height: 40,
                padding: 10,
                border: "1px solid #ccc",
                borderRadius: 8,
              }}
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {initialBoxes.slice(0, normalizeWeeklyCount(initialWeeklyCount)).map((box, i) => (
              <div
                key={`initial-box-${i}`}
                style={{ padding: 10, border: "1px solid var(--surface-border)", borderRadius: 10, background: "var(--surface-bg)" }}
              >
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{i + 1}번째 수업 박스</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.2fr 1fr 1fr 1.2fr",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <select
                    value={box.weekday}
                    onChange={(e) => updateInitialBox(i, { weekday: Number(e.target.value) as Weekday })}
                    style={{ width: "100%", height: 40, padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
                    aria-label={`${i + 1}번째 수업 요일`}
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                      <option key={`weekday-${i}-${d}`} value={d}>
                        {weekdayLabel(d)}요일
                      </option>
                    ))}
                  </select>
                  <select
                    value={box.hour}
                    onChange={(e) => updateInitialBox(i, { hour: Number(e.target.value) })}
                    style={{ width: "100%", height: 40, padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
                    aria-label={`${i + 1}번째 시작 시`}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={`hour-${i}-${h}`} value={h}>
                        {String(h).padStart(2, "0")}시
                      </option>
                    ))}
                  </select>
                  <select
                    value={box.minute ?? 0}
                    onChange={(e) => updateInitialBox(i, { minute: Number(e.target.value) })}
                    style={{ width: "100%", height: 40, padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
                    aria-label={`${i + 1}번째 시작 분`}
                  >
                    <option value={0}>00분</option>
                    <option value={30}>30분</option>
                  </select>
                  <select
                    value={box.durationHour}
                    onChange={(e) => updateInitialBox(i, { durationHour: Number(e.target.value) })}
                    style={{ width: "100%", height: 40, padding: 8, border: "1px solid #ccc", borderRadius: 8 }}
                    aria-label={`${i + 1}번째 수업 시간`}
                  >
                    {[0.5, 1, 1.5, 2, 2.5, 3].map((dur) => (
                      <option key={`dur-${i}-${dur}`} value={dur}>
                        {dur}시간
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 8, color: "var(--text-muted)" }}>
            생성될 초기 회차 수: {selectedRules.length}회
          </div>
        </div>

        {error ? <div style={{ color: "crimson", fontWeight: 700}}>{error}</div> : null}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => router.push(onDoneGoTo)} style={{ padding: "10px 14px" }} disabled={saving}>
            취소
          </button>
          <button onClick={() => void onSubmit()} style={{ padding: "10px 14px", fontWeight: 800 }} disabled={saving}>
            {saving ? "저장 중..." : "생성"}
          </button>
        </div>
      </section>

      {sheetModalOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2200,
            background: "rgba(15, 23, 42, 0.45)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
        >
          <section
            style={{
              width: "100%",
              maxWidth: 640,
              borderRadius: 14,
              border: "1px solid #cbd5e1",
              background: "#fff",
              padding: 16,
              boxShadow: "0 16px 40px rgba(15, 23, 42, 0.28)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900, color: "#0f172a" }}>
              시트값 입력
            </h2>
            <p style={{ marginTop: 8, marginBottom: 0, color: "#334155", fontWeight: 700 }}>
              파란 셀값을 붙혀넣으시오.
            </p>

            <textarea
              value={sheetRawInput}
              onChange={(e) => setSheetRawInput(e.target.value)}
              placeholder={
                "예시)\n시작일\t1994. 1. 29.\n학생이름\t옥진수\n학생전화번호\t01089727209\n학교\t남천중학교\n학년\t13\n학생 구글 이메일\trapah0310@gmail.com\n학부모 연락처\t01089727209"
              }
              style={{
                marginTop: 12,
                width: "100%",
                minHeight: 220,
                resize: "vertical",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                padding: 12,
                fontSize: 14,
                lineHeight: 1.45,
              }}
            />

            {sheetModalError ? (
              <div
                style={{
                  marginTop: 10,
                  borderRadius: 8,
                  border: "1px solid #fecaca",
                  background: "#fef2f2",
                  color: "#b91c1c",
                  padding: "8px 10px",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {sheetModalError}
              </div>
            ) : null}

            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setSheetModalOpen(false)}
                style={{ padding: "10px 14px" }}
                disabled={saving}
              >
                취소
              </button>
              <button
                type="button"
                onClick={onApplySheetInput}
                style={{ padding: "10px 14px", fontWeight: 800 }}
                disabled={saving}
              >
                적용
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
