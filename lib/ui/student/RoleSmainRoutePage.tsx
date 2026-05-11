import { notFound } from "next/navigation";
import StudentMainClient from "@/lib/ui/student/StudentMainClient";
import StudentEditBase from "@/lib/ui/student/StudentEditBase";
import StudentMainSessionListBase from "@/lib/ui/student/StudentMainSessionListBase";
import StudentMainSessionDetailBase from "@/lib/ui/student/StudentMainSessionDetailBase";

type Role = "a" | "t" | "s";

type RoleSmainRoutePageProps = {
  role: Role;
  slug?: string[];
};

export default function RoleSmainRoutePage({ role, slug = [] }: RoleSmainRoutePageProps) {
  const [first, second, third] = slug;

  if (!first) {
    return <StudentMainClient role={role} />;
  }

  if (first === "edit" && !second) {
    return <StudentEditBase role={role} />;
  }

  if (first === "session" && !second) {
    return <StudentMainSessionListBase role={role} />;
  }

  if (first === "session" && second && !third && /^\d+$/.test(second)) {
    return <StudentMainSessionDetailBase role={role} />;
  }

  notFound();
}
