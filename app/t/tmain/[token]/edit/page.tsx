import StudentEditTokenPageClient from "@/lib/ui/student/StudentEditTokenPageClient";

export default function TeacherStudentEditPage() {
  return <StudentEditTokenPageClient mode="teacher" onDoneGoTo="/t/tmain" />;
}
