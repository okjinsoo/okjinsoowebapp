"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStudentRegistry } from "@/lib/hooks/useStudentRegistry";
import {
  buildAdminTeacherStudentEditPath,
  buildAdminTeacherStudentHubPath,
  buildAdminTeacherStudentSessionDetailPath,
  buildAdminTeacherStudentSessionListPath,
  buildAdminTeacherTmainPath,
  buildTmainBasePath,
} from "@/lib/routes/appRouteBuilder";
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

function buildStudentScopedPath(args: {
  teacherToken: string;
  studentToken: string;
  routeKind: RouteKind;
  sessionIndex?: number;
}): string {
  if (args.routeKind === "session-list") {
    return buildAdminTeacherStudentSessionListPath({
      teacherToken: args.teacherToken,
      studentToken: args.studentToken,
    });
  }
  if (args.routeKind === "session-detail") {
    return buildAdminTeacherStudentSessionDetailPath({
      teacherToken: args.teacherToken,
      studentToken: args.studentToken,
      sessionIndex: Number.isFinite(args.sessionIndex) ? Number(args.sessionIndex) : 1,
    });
  }
  if (args.routeKind === "edit") {
    return buildAdminTeacherStudentEditPath({
      teacherToken: args.teacherToken,
      studentToken: args.studentToken,
    });
  }
  return buildAdminTeacherStudentHubPath({
    teacherToken: args.teacherToken,
    studentToken: args.studentToken,
  });
}

export default function AdminTeacherStudentRouteGateCard({
  teacherToken,
  studentToken,
  routeKind,
  sessionIndex,
}: Props) {
  const router = useRouter();
  const { students, teachers } = useStudentRegistry();

  const currentStudent = useMemo(
    () => students.find((student) => student.token === studentToken) ?? null,
    [students, studentToken]
  );
  const teacherId = currentStudent?.teacherId ?? teachers.find((teacher) => teacher.token === teacherToken)?.id ?? null;
  const canonicalTeacherToken = useMemo(() => {
    if (!currentStudent?.teacherId) return null;
    const teacher = teachers.find((row) => row.id === currentStudent.teacherId);
    const token = (teacher?.token ?? "").trim();
    return token || null;
  }, [currentStudent, teachers]);

  useEffect(() => {
    if (teacherId) saveCurrentTeacherId(teacherId);
    saveCurrentStudentToken(studentToken);
  }, [teacherId, studentToken]);

  useEffect(() => {
    if (!canonicalTeacherToken) return;
    if (canonicalTeacherToken === teacherToken) return;
    router.replace(
      buildStudentScopedPath({
        teacherToken: canonicalTeacherToken,
        studentToken,
        routeKind,
        sessionIndex,
      })
    );
  }, [canonicalTeacherToken, routeKind, router, sessionIndex, studentToken, teacherToken]);

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
          router.push(buildTmainBasePath("a"));
          return;
        }
        router.push(buildAdminTeacherTmainPath(nextTeacherToken));
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
