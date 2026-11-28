"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Student, Teacher } from "@/lib/types/index";
import { TUTORWEB_EVENTS } from "@/lib/events/tutorwebEvents";
import { GATE_EVENT, loadCurrentStudentToken } from "@/lib/ui/common/roleGateStorage";
import { readLocalStudents, readLocalTeachers } from "@/lib/storage/sharedSnapshot";
import { buildCrumbs, isActive, menuFor } from "@/lib/ui/common/navModel";

/** 왼쪽 메뉴(노트북) / 아래 탭(휴대폰). 같은 목록을 CSS가 자리만 바꿔 보여 줌 */
export default function AppNav() {
  const pathname = usePathname() ?? "/";
  const menu = menuFor(pathname);
  if (!menu) return null;

  return (
    <nav className="app-nav" aria-label="주요 메뉴">
      {menu.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="app-nav-link"
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
          >
            <span className="app-nav-full">{item.label}</span>
            <span className="app-nav-short" aria-hidden="true">{item.short}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function useNames() {
  const [data, setData] = useState<{ students: Student[]; teachers: Teacher[]; selected: string | null }>({
    students: [],
    teachers: [],
    selected: null,
  });

  useEffect(() => {
    const refresh = () =>
      setData({ students: readLocalStudents(), teachers: readLocalTeachers(), selected: loadCurrentStudentToken() });
    refresh();
    const events = [TUTORWEB_EVENTS.studentsUpdated, TUTORWEB_EVENTS.teachersUpdated, GATE_EVENT, "storage"];
    events.forEach((e) => window.addEventListener(e, refresh));
    return () => events.forEach((e) => window.removeEventListener(e, refresh));
  }, []);

  return data;
}

/** 지금 위치: 예) 관리자 메인 › 옥진수 › 조윤우 › 60회차 */
export function AppBreadcrumb() {
  const pathname = usePathname() ?? "/";
  const { students, teachers, selected } = useNames();

  const crumbs = useMemo(
    () =>
      buildCrumbs(
        pathname,
        {
          student: (token) => students.find((s) => s.token === token)?.name?.trim() || null,
          teacher: (token) => teachers.find((t) => t.token === token || t.id === token)?.name?.trim() || null,
        },
        selected,
      ),
    [pathname, students, teachers, selected],
  );

  if (crumbs.length === 0) return null;

  return (
    <nav className="app-crumbs" aria-label="현재 위치">
      {crumbs.map((c, i) => (
        <span key={`${i}:${c.label}`} className="app-crumb">
          {i > 0 ? <span aria-hidden="true" className="app-crumb-sep">›</span> : null}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
