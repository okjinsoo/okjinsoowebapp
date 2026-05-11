import StudentEditTokenPageClient from "@/lib/ui/student/StudentEditTokenPageClient";
import { buildTmainBasePath } from "@/lib/routes/appRouteBuilder";

export default function TeacherStudentEditPage() {
  return <StudentEditTokenPageClient mode="teacher" onDoneGoTo={buildTmainBasePath("t")} />;
}
