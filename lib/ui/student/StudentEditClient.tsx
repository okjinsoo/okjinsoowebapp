// v1/lib/ui/student/StudentEditClient.tsx
"use client";

import { browserStorage } from "@/lib/storage/browserStorage";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Id, Student, Teacher } from "@/lib/types/index";
import { findStudentByToken, removeStudent, upsertStudent } from "@/lib/storage/students";
import { loadSessions, removeSessionsByStudentId, saveSessions } from "@/lib/storage/sessions";
import { clearConsultationsByStudent } from "@/lib/storage/consultations";
import { clearCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { buildBaseDatesISO, metaMapKey } from "@/lib/ui/session/sessionEffective";
import { makeId } from "@/lib/utils/id";
import { nowIso } from "@/lib/utils/date";
import { normalizePhoneDigits } from "@/lib/utils/phone";

function normalizePlanCount(n: number): number {
  if (!Number.isFinite(n)) return 12;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

export type StudentEditMode = "admin" | "teacher";

function clearStudentScopedStorage(token: string) {
  if (typeof window === "undefined" || !token) return;
  try {
    const prefix = `mk3:${token}:session:`;
    const removeKeys: string[] = [];
    for (let i = 0; i < browserStorage.length; i++) {
      const key = browserStorage.key(i);
      if (!key) continue;
      if (key.startsWith(prefix)) removeKeys.push(key);
    }
    for (const k of removeKeys) browserStorage.removeItem(k);
    browserStorage.removeItem(metaMapKey(token));
  } catch {
    // ignore
  }
}

export default function StudentEditClient(props: {
  mode: StudentEditMode;
  teachers: Teacher[];
  token: string;
  fixedTeacherId?: Id;
  onDoneGoTo: string;
}) {
  const router = useRouter();
  const { mode, teachers, token, fixedTeacherId, onDoneGoTo } = props;

  const [student, setStudent] = useState<Student | null>(null);
  const [initialized, setInitialized] = useState(false);

  const [teacherId, setTeacherId] = useState<string>("");
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female">("");
  const [googleEmail, setGoogleEmail] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
  const [startDate, setStartDate] = useState("");
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");
  const [parentRole, setParentRole] = useState<"" | "father" | "mother">("");
  const [parentPhone, setParentPhone] = useState("");
  const [planCount, setPlanCount] = useState<number>(12);
  const [error, setError] = useState<string>("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const gradeOptions = useMemo(() => {
    const out: Array<{ label: string; value: string }> = [];
    for (let i = 1; i <= 6; i++) out.push({ label: `초${i}`, value: String(i) });
    for (let i = 1; i <= 3; i++) out.push({ label: `중${i}`, value: String(i + 6) });
    for (let i = 1; i <= 3; i++) out.push({ label: `고${i}`, value: String(i + 9) });
    out.push({ label: "N수", value: "N수" });
    return out;
  }, []);

  const teacherLabel = useMemo(() => {
    if (!teacherId) return "미선택";
    return teachers.find((t) => t.id === teacherId)?.name ?? teacherId;
  }, [teacherId, teachers]);

  useEffect(() => {
    const st = findStudentByToken(token);
    setStudent(st);
  }, [token]);

  useEffect(() => {
    if (!student || initialized) return;
    setTeacherId(student.teacherId ?? fixedTeacherId ?? "");
    setName(student.name ?? "");
    setGender(student.gender ?? "");
    setGoogleEmail(student.googleEmail ?? "");
    setStudentPhone(student.studentPhone ?? "");
    setStartDate(student.startDate ?? "");
    setSchool(student.school ?? "");
    setGrade(student.grade ?? "");
    setPlanCount(Math.max(1, Number(student.planCount) || 12));
    setParentRole(student.parentRole ?? "");
    setParentPhone(student.parentPhone ?? "");
    setInitialized(true);
  }, [student, initialized, fixedTeacherId]);

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
    if (normalizePlanCount(planCount) < 1) return fail("회차 수를 확인해주세요.");
    if (!normalizePhoneDigits(parentPhone)) return fail("학부모 전화번호를 입력해주세요.");

    return true;

    function fail(msg: string) {
      setError(msg);
      return false;
    }
  }

  function onSubmit() {
    if (!student) return;
    if (!validate()) return;
    const nextPlanCount = normalizePlanCount(planCount);

    const updated: Student = {
      ...student,
      teacherId: teacherId,
      name: name.trim(),
      gender: gender ? gender : undefined,
      googleEmail: googleEmail.trim(),
      studentPhone: normalizePhoneDigits(studentPhone),
      startDate: startDate || student.startDate,
      planCount: nextPlanCount,
      school: school.trim(),
      grade: grade,
      parentRole: parentRole ? parentRole : undefined,
      parentPhone: normalizePhoneDigits(parentPhone),
    };

    upsertStudent(updated);
    const all = loadSessions();
    const others = all.filter((s) => s.studentId !== student.id);
    const own = all.filter((s) => s.studentId === student.id);
    const ownByIndex = new Map(own.map((s) => [s.index, s]));
    const baseDatesISO = buildBaseDatesISO(updated, 0);
    const nextOwn = [];
    for (let idx = 1; idx <= nextPlanCount; idx++) {
      const prev = ownByIndex.get(idx);
      nextOwn.push(
        prev ?? {
          id: makeId(),
          studentId: student.id,
          index: idx,
          displayAt: baseDatesISO[idx - 1] ?? nowIso(),
          state: "normal" as const,
          createdAt: nowIso(),
        }
      );
    }
    saveSessions([...others, ...nextOwn]);
    router.push(onDoneGoTo);
  }

  function onDeleteConfirm() {
    if (!student || mode !== "admin" || deleting) return;
    setDeleting(true);
    try {
      removeStudent(student.id);
      removeSessionsByStudentId(student.id);
      clearConsultationsByStudent(student.id);
      clearStudentScopedStorage(student.token);
      clearCurrentStudentToken();
      router.push("/a/students");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (!student) {
    return (
      <main style={{ padding: 20, maxWidth: 860, margin: "0 auto"}}>
        <button onClick={() => router.push(onDoneGoTo)} className="btn btn-bold">
          돌아가기
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          학생 정보 수정
        </div>
        <div style={{ marginTop: 10, color: "#666"}}>학생을 찾지 못했습니다.</div>
      </main>
    );
  }

  return (
    <main style={{ padding: 20, maxWidth: 860, margin: "0 auto"}}>
      <div>
        <button onClick={() => router.push(onDoneGoTo)} className="btn btn-bold" title="돌아가기">
          돌아가기
        </button>
        <div style={{ marginTop: 8, textAlign: "center" }} className="page-title">
          학생 정보 수정 ({mode === "admin" ? "원장" : "선생님"})
        </div>
      </div>

      <section style={{ marginTop: 14, display: "grid", gap: 14 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">시작일</div>
          {mode === "admin" ? (
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              style={{
                width: "100%",
                height: 40,
                padding: 10,
                border: "1px solid #ccc",
                borderRadius: 8,
                marginTop: 6,
              }}
            />
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
              <div>
                <b>{startDate || "-"}</b>
              </div>
              <div style={{ color: "#666", marginTop: 4 }}>
                선생님 화면에서는 시작일이 고정됩니다.
              </div>
            </div>
          )}
        </div>

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
                  placeholder="예: 010-1234-5678"
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
                  placeholder="예: ○○고등학교"
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
                  placeholder="예: 010-0000-0000"
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

        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12, background: "#fff" }}>
          <div className="card-title">회차 수</div>
          <input
            type="number"
            min={1}
            max={200}
            value={planCount}
            onChange={(e) => setPlanCount(normalizePlanCount(Number(e.target.value)))}
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

        {error ? <div style={{ color: "#dc2626"}}>{error}</div> : null}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <div>
            {mode === "admin" ? (
              <button className="btn btn-red" onClick={() => setDeleteOpen(true)}>
                삭제
              </button>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => router.push(onDoneGoTo)} style={{ padding: "8px 12px" }}>
            취소
          </button>
          <button onClick={onSubmit} style={{ padding: "8px 12px", fontWeight: 800 }}>
            저장
          </button>
          </div>
        </div>
      </section>
      {deleteOpen ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => (deleting ? null : setDeleteOpen(false))}
        >
          <div
            style={{
              width: "min(420px, calc(100vw - 24px))",
              background: "#fff",
              border: "1px solid #ddd",
              borderRadius: 10,
              padding: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="card-title">정말 삭제하시겠습니까?</div>
            <div className="text-muted" style={{ marginTop: 8 }}>
              학생 정보, 회차, 상담 기록이 모두 삭제됩니다.
            </div>
            <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn btn-bold" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                아니오
              </button>
              <button className="btn btn-red" onClick={onDeleteConfirm} disabled={deleting}>
                예
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
