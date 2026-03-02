"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import type { Student } from "@/lib/types/index";
import { loadStudents } from "@/lib/storage/students";
import { pullSharedSnapshotAndHydrateWithOptions } from "@/lib/storage/sharedSnapshot";
import { GATE_EVENT, loadCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";

const APP_TITLE = "옥진수학";

function isNumericSegment(value: string | undefined): boolean {
  if (!value) return false;
  return /^\d+$/.test(value);
}

function findStudentName(token: string | null, students: Student[]): string | null {
  if (!token) return null;
  const found = students.find((student) => student.token === token);
  const name = (found?.name ?? "").trim();
  return name || null;
}

function extractTokenFromPath(parts: string[]): string | null {
  if (parts[0] === "a" && parts[1] === "students" && parts[2] && parts[2] !== "new") {
    return parts[2];
  }
  if ((parts[0] === "a" || parts[0] === "t") && parts[1] === "tmain" && parts[2] && parts[2] !== "new") {
    return parts[2];
  }
  return null;
}

function withPrefix(label: string): string {
  return `${label} · ${APP_TITLE}`;
}

function resolveTitle(pathname: string, students: Student[], selectedToken: string | null): string {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return APP_TITLE;

  if (parts[0] === "auth" && parts[1] === "callback") return withPrefix("로그인 처리");
  if (parts[0] === "lib" && parts[1] === "lectures") return withPrefix("강의 저장소");
  if (parts[0] === "t" && parts[1] === "lectures") return withPrefix("강의 저장소");

  if (parts[0] === "a" && parts[1] === "amain") return withPrefix("관리자 메인");
  if (parts[0] === "a" && parts[1] === "students" && parts.length === 2) return withPrefix("학생 관리");
  if (parts[0] === "a" && parts[1] === "students" && parts[2] === "new") return withPrefix("학생 등록");
  if (parts[0] === "a" && parts[1] === "teachers" && parts.length === 2) return withPrefix("선생님 관리");
  if (parts[0] === "a" && parts[1] === "teachers" && parts[2] === "new") return withPrefix("선생님 등록");
  if (parts[0] === "a" && parts[1] === "teachers" && parts[2] === "edit") return withPrefix("선생님 정보 수정");

  if (parts[0] === "t" && parts[1] === "tmain" && parts.length === 2) return withPrefix("학생 관리");
  if (parts[0] === "a" && parts[1] === "tmain" && parts.length === 2) return withPrefix("학생 관리");
  if ((parts[0] === "t" || parts[0] === "a") && parts[1] === "tmain" && parts[2] === "new") return withPrefix("학생 등록");

  const tokenFromPath = extractTokenFromPath(parts);
  const activeToken = tokenFromPath ?? (parts[1] === "smain" ? selectedToken : null);
  const studentName = findStudentName(activeToken, students);
  const studentLabel = studentName ?? "학생";

  if (tokenFromPath) {
    if (parts[3] === "session" && isNumericSegment(parts[4])) {
      return withPrefix(`${studentLabel} ${Number(parts[4])}회차 학습`);
    }
    if (parts[3] === "session") return withPrefix(`${studentLabel} 수업 목록`);
    if (parts[3] === "edit") return withPrefix(`${studentLabel} 정보 수정`);
    return withPrefix(`${studentLabel} 정보`);
  }

  if (parts[1] === "smain") {
    if (parts[2] === "session" && isNumericSegment(parts[3])) {
      return withPrefix(`${studentLabel} ${Number(parts[3])}회차 학습`);
    }
    if (parts[2] === "session") return withPrefix(`${studentLabel} 수업 목록`);
    if (parts[2] === "edit") return withPrefix(`${studentLabel} 정보 수정`);
    return withPrefix(`${studentLabel} 정보`);
  }

  return APP_TITLE;
}

export default function PageTitleAgent() {
  const pathname = usePathname() ?? "/";
  const [students, setStudents] = useState<Student[]>(() => loadStudents());
  const [gateTick, setGateTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refreshStudents = () => setStudents(loadStudents());
    const onGateUpdated = () => setGateTick((v) => v + 1);

    refreshStudents();
    void pullSharedSnapshotAndHydrateWithOptions({ forceRemote: true })
      .then((snapshot) => {
        if (cancelled) return;
        if (snapshot) setStudents(snapshot.students);
      })
      .catch(() => {
        // 로그인 전 홈 화면에서는 서버 호출 실패가 정상일 수 있음.
      });

    window.addEventListener(TUTORWEB_EVENTS.studentsUpdated, refreshStudents);
    window.addEventListener(GATE_EVENT, onGateUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(TUTORWEB_EVENTS.studentsUpdated, refreshStudents);
      window.removeEventListener(GATE_EVENT, onGateUpdated);
    };
  }, []);

  const nextTitle = useMemo(() => {
    void gateTick;
    const selectedToken = loadCurrentStudentToken();
    return resolveTitle(pathname, students, selectedToken);
  }, [pathname, students, gateTick]);

  useEffect(() => {
    document.title = nextTitle;
  }, [nextTitle]);

  return null;
}
