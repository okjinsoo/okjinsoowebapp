import "server-only";

import { fetchMainSnapshotAsAdmin, getSupabaseAdminConfig } from "@/lib/server/supabaseAdmin";

export async function resolveTeacherTokenByStudentToken(studentToken: string): Promise<string | null> {
  try {
    const normalizedStudentToken = studentToken.trim();
    if (!normalizedStudentToken) return null;

    const config = getSupabaseAdminConfig();
    if (!config) return null;

    const snapshot = await fetchMainSnapshotAsAdmin(config);
    if (!snapshot) return null;

    const student = snapshot.students.find((row) => row.token === normalizedStudentToken);
    if (!student?.teacherId) return null;

    const teacher = snapshot.teachers.find((row) => row.id === student.teacherId);
    const teacherToken = (teacher?.token ?? "").trim();
    return teacherToken || null;
  } catch (error) {
    console.warn("[admin-tmain-routes] resolveTeacherTokenByStudentToken failed:", error);
    return null;
  }
}
