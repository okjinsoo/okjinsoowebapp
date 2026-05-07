"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";
import StudentListSection from "@/lib/ui/admin/students/StudentListSection";
import type { AdminStudentCard } from "@/lib/ui/admin/students/useAdminStudentsPageData";
import { useAdminStudentsPageData } from "@/lib/ui/admin/students/useAdminStudentsPageData";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { metaMapKey } from "@/lib/factories/sessionFactories";
import { readSnapshotServerFirst } from "@/lib/storage/serverRead";
import {
  isLocalOnlySnapshotMode,
  pushSharedSnapshot,
  readLocalSharedStateKv,
} from "@/lib/storage/sharedSnapshot";
import {
  SHARED_LECTURE_TREE_KEY,
} from "@/lib/storage/sharedStateKeys";
import type { Session, Student, Teacher } from "@/lib/types/index";

type StudentBackupFileV1 = {
  format: "tutorweb_student_backup";
  version: 1 | 2;
  payload: {
    student: Student;
    teacher: Teacher | null;
    sessions: Session[];
    stateKv: Record<string, string>;
  };
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeStateKvStrings(raw: unknown): Record<string, string> {
  const obj = asObject(raw);
  if (!obj) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!key || typeof value !== "string") continue;
    out[key] = value;
  }
  return out;
}

function sessionStatePrefix(token: string): string {
  return `mk3:${token}:session:`;
}

function collectStudentScopedStateKeys(stateKv: Record<string, string>, studentToken: string): string[] {
  if (!studentToken) return [];
  const prefix = sessionStatePrefix(studentToken);
  const metaKey = metaMapKey(studentToken);
  return Object.keys(stateKv).filter((key) => key === metaKey || key.startsWith(prefix));
}

function parseStudentBackupFile(raw: unknown): StudentBackupFileV1 | null {
  const root = asObject(raw);
  if (!root) return null;
  if (root.format !== "tutorweb_student_backup") return null;
  const version = Number(root.version);
  if (version !== 1 && version !== 2) return null;
  const payload = asObject(root.payload);
  if (!payload) return null;
  const student = asObject(payload.student);
  if (!student || typeof student.id !== "string" || typeof student.token !== "string") return null;
  const sessions = Array.isArray(payload.sessions) ? (payload.sessions as Session[]) : [];
  const teacherObj = payload.teacher === null ? null : asObject(payload.teacher);
  const teacher = teacherObj ? (teacherObj as Teacher) : null;
  const stateKv = normalizeStateKvStrings(payload.stateKv);
  return {
    format: "tutorweb_student_backup",
    version: version as 1 | 2,
    payload: {
      student: student as Student,
      teacher,
      sessions,
      stateKv,
    },
  };
}

export default function AdminStudentsPageClient() {
  const router = useRouter();
  const { cards } = useAdminStudentsPageData();
  const localOnlyMode = isLocalOnlySnapshotMode();
  const [isSyncWorking, setIsSyncWorking] = useState(false);
  const syncInputRef = useRef<HTMLInputElement | null>(null);

  const openStudentMain = (card: AdminStudentCard) => {
    if (card.teacherId) saveCurrentTeacherId(card.teacherId);
    saveCurrentStudentToken(card.token);
    router.push("/a/smain");
  };

  const openStudentEdit = (card: AdminStudentCard) => {
    if (card.teacherId) saveCurrentTeacherId(card.teacherId);
    saveCurrentStudentToken(card.token);
    router.push("/a/smain/edit");
  };

  function openSyncFilePicker() {
    if (!localOnlyMode) {
      alert("학생 동기화는 로컬 테스트 서버에서만 사용할 수 있습니다.");
      return;
    }
    if (isSyncWorking) return;
    syncInputRef.current?.click();
  }

  async function handleSyncBackupFile(file: File) {
    if (!localOnlyMode) {
      alert("학생 동기화는 로컬 테스트 서버에서만 사용할 수 있습니다.");
      return;
    }
    if (isSyncWorking) return;
    setIsSyncWorking(true);
    try {
      const raw = await file.text();
      const parsed = parseStudentBackupFile(JSON.parse(raw));
      if (!parsed) {
        throw new Error("invalid_backup_format");
      }

      const importedStudent = parsed.payload.student;
      const importedTeacher = parsed.payload.teacher;
      const importedToken = importedStudent.token ?? "";
      if (!importedToken) {
        throw new Error("invalid_student_token");
      }

      const confirmMessage =
        `${importedStudent.name ?? "-"} 학생 데이터를 로컬에 동기화합니다.\n` +
        "같은 학생(token) 기존 데이터는 교체됩니다.\n" +
        "계속 진행할까요?";
      if (!window.confirm(confirmMessage)) {
        return;
      }

      const baseline = await readSnapshotServerFirst();
      const localStateKv = readLocalSharedStateKv();

      const existingSameToken = baseline.students.find((row) => row.token === importedToken);
      const removeStudentIds = new Set<string>([importedStudent.id]);
      if (existingSameToken) {
        removeStudentIds.add(existingSameToken.id);
      }

      const nextStudents = baseline.students
        .filter((row) => !removeStudentIds.has(row.id) && row.token !== importedToken)
        .concat(importedStudent);
      const nextSessions = baseline.sessions
        .filter((row) => !removeStudentIds.has(row.studentId))
        .concat(parsed.payload.sessions.filter((row) => row.studentId === importedStudent.id));

      const nextTeachers = importedTeacher
        ? baseline.teachers.filter((row) => row.id !== importedTeacher.id).concat(importedTeacher)
        : baseline.teachers;

      const dropStateKeys = collectStudentScopedStateKeys(localStateKv, importedToken);
      const nextStateKvPatch: Record<string, string> = {
        ...parsed.payload.stateKv,
      };
      if (!nextStateKvPatch[SHARED_LECTURE_TREE_KEY] && localStateKv[SHARED_LECTURE_TREE_KEY]) {
        nextStateKvPatch[SHARED_LECTURE_TREE_KEY] = localStateKv[SHARED_LECTURE_TREE_KEY];
      }

      await pushSharedSnapshot({
        teachers: nextTeachers,
        students: nextStudents,
        sessions: nextSessions,
        stateKv: nextStateKvPatch,
        dropStateKeys,
      });

      alert("학생 동기화가 완료되었습니다.");
    } catch (err) {
      console.error("학생 동기화 실패:", err);
      alert("학생 동기화에 실패했습니다. JSON 파일 형식을 확인해주세요.");
    } finally {
      setIsSyncWorking(false);
    }
  }

  function onSyncFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void handleSyncBackupFile(file);
  }

  return (
    <main style={{ padding: 20, maxWidth: 980, margin: "0 auto" }}>
      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => router.push("/a/amain")}>
          관리자 페이지
        </button>
      </div>

      <section style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">학생 관리 (원장)</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {localOnlyMode ? (
            <>
              <button
                className="btn"
                onClick={openSyncFilePicker}
                disabled={isSyncWorking}
                title="로컬 테스트 서버 전용: 학생 백업 JSON 업로드"
              >
                {isSyncWorking ? "동기화 중..." : "학생 동기화"}
              </button>
              <input
                ref={syncInputRef}
                type="file"
                accept="application/json,.json"
                onChange={onSyncFileInputChange}
                style={{ display: "none" }}
              />
            </>
          ) : null}
          <button onClick={() => router.push("/a/students/new")} style={{ padding: "8px 12px", fontWeight: 800 }}>
            + 학생 추가
          </button>
        </div>
      </section>

      <StudentListSection
        title="재학생 리스트"
        cards={cards}
        onOpenStudentMain={openStudentMain}
        onOpenStudentEdit={openStudentEdit}
      />
    </main>
  );
}
