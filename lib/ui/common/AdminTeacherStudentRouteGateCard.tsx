"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import { saveCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { saveCurrentTeacherId } from "@/lib/storage/teachers";

type RouteKind = "hub" | "session-list" | "session-detail" | "edit";

type Props = {
  teacherToken: string;
  studentToken: string;
  routeKind: RouteKind;
  sessionIndex?: number;
};

function encode(v: string): string {
  return encodeURIComponent(v);
}

function buildStudentScopedPath(args: {
  teacherToken: string;
  studentToken: string;
  routeKind: RouteKind;
  sessionIndex?: number;
}): string {
  const base = `/a/tmain/${encode(args.teacherToken)}/smain/${encode(args.studentToken)}`;
  if (args.routeKind === "session-list") return `${base}/session`;
  if (args.routeKind === "session-detail") return `${base}/session/${Number.isFinite(args.sessionIndex) ? args.sessionIndex : 1}`;
  if (args.routeKind === "edit") return `${base}/edit`;
  return base;
}

export default function AdminTeacherStudentRouteGateCard({
  teacherToken,
  studentToken,
  routeKind,
  sessionIndex,
}: Props) {
  const router = useRouter();
  const { students, teachers } = useStudentRegistry();

  const currentTeacher = useMemo(
    () => teachers.find((teacher) => teacher.token === teacherToken) ?? null,
    [teachers, teacherToken]
  );
  const currentStudent = useMemo(
    () => students.find((student) => student.token === studentToken) ?? null,
    [students, studentToken]
  );
  const teacherId = currentTeacher?.id ?? currentStudent?.teacherId ?? null;

  useEffect(() => {
    if (teacherId) saveCurrentTeacherId(teacherId);
    saveCurrentStudentToken(studentToken);
  }, [teacherId, studentToken]);

  return (
    <RoleGateCard
      role="a"
      teachers={teachers}
      students={students}
      teacherId={teacherId}
      studentToken={studentToken}
      onTeacherChange={(nextTeacherId) => {
        saveCurrentTeacherId(nextTeacherId);
        const nextTeacherToken = (teachers.find((teacher) => teacher.id === nextTeacherId)?.token ?? "").trim();
        if (!nextTeacherToken) {
          router.push("/a/tmain");
          return;
        }
        router.push(`/a/tmain/${encode(nextTeacherToken)}`);
      }}
      onStudentChange={(nextStudentToken) => {
        const nextStudent = students.find((student) => student.token === nextStudentToken);
        if (!nextStudent) return;
        const nextTeacher = teachers.find((teacher) => teacher.id === nextStudent.teacherId);
        const nextTeacherToken = (nextTeacher?.token ?? "").trim();
        if (!nextTeacherToken) return;
        saveCurrentStudentToken(nextStudentToken);
        if (nextStudent.teacherId) saveCurrentTeacherId(nextStudent.teacherId);
        router.push(
          buildStudentScopedPath({
            teacherToken: nextTeacherToken,
            studentToken: nextStudentToken,
            routeKind,
            sessionIndex,
          })
        );
      }}
    />
  );
}
