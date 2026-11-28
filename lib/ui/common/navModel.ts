// 재구성 2단계: 주소(URL)만 보고 메뉴와 위치 표시(빵부스러기)를 만드는 순수 함수

export type NavItem = { label: string; href: string; match: string[] };
export type Crumb = { label: string; href?: string };
export type NameLookup = {
  student: (token: string | null) => string | null;
  teacher: (token: string) => string | null;
};

const ADMIN_MENU: NavItem[] = [
  { label: "관리자 메인", href: "/a/amain", match: ["/a/amain", "/a/tmain", "/a/smain"] },
  { label: "학생 관리", href: "/a/students", match: ["/a/students"] },
  { label: "선생님 관리", href: "/a/teachers", match: ["/a/teachers"] },
  { label: "강의 저장소", href: "/lib/lectures", match: ["/lib/lectures"] },
];

const TEACHER_MENU: NavItem[] = [
  { label: "내 학생", href: "/t/tmain", match: ["/t/tmain", "/t/smain"] },
  { label: "강의 저장소", href: "/t/lectures", match: ["/t/lectures"] },
];

/** 관리자(/a, /lib)·선생님(/t) 화면에만 메뉴. 학생·공개 화면은 null */
export function menuFor(pathname: string): NavItem[] | null {
  if (pathname.startsWith("/a/") || pathname.startsWith("/lib/")) return ADMIN_MENU;
  if (pathname.startsWith("/t/")) return TEACHER_MENU;
  return null;
}

export function isActive(item: NavItem, pathname: string): boolean {
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

/** 학생 화면 아래쪽(정보 수정·수업 목록·N회차) 꼬리 */
function studentTail(rest: string[], base: string, studentLabel: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: studentLabel, href: base }];
  if (rest[0] === "edit") crumbs.push({ label: "정보 수정" });
  else if (rest[0] === "session" && /^\d+$/.test(rest[1] ?? "")) crumbs.push({ label: `${Number(rest[1])}회차` });
  else if (rest[0] === "session") crumbs.push({ label: "수업 목록" });
  return crumbs;
}

function dropLastHref(crumbs: Crumb[]): Crumb[] {
  return crumbs.map((c, i) => (i === crumbs.length - 1 ? { label: c.label } : c));
}

/** 지금 위치. 한 칸뿐이면 빈 배열(메뉴가 이미 알려 주므로) */
export function buildCrumbs(pathname: string, names: NameLookup, selectedStudentToken: string | null): Crumb[] {
  const p = pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s));
  const studentLabel = (token: string | null) => names.student(token) ?? "학생";
  let crumbs: Crumb[] = [];

  if (p[0] === "a" && p[1] === "tmain") {
    crumbs = [{ label: "관리자 메인", href: "/a/amain" }];
    if (p[2] === "new") crumbs.push({ label: "학생 등록" });
    else if (p[2] && p[2] !== "teacher") {
      const tBase = `/a/tmain/${encodeURIComponent(p[2])}`;
      crumbs.push({ label: names.teacher(p[2]) ?? "선생님", href: tBase });
      if (p[3] === "smain" && p[4]) {
        crumbs.push(...studentTail(p.slice(5), `${tBase}/smain/${encodeURIComponent(p[4])}`, studentLabel(p[4])));
      }
    }
  } else if (p[0] === "a" && p[1] === "students") {
    crumbs = [{ label: "학생 관리", href: "/a/students" }];
    if (p[2] === "new") crumbs.push({ label: "학생 등록" });
    else if (p[2]) crumbs.push(...studentTail(p.slice(3), `/a/students/${encodeURIComponent(p[2])}`, studentLabel(p[2])));
  } else if (p[0] === "a" && p[1] === "teachers") {
    crumbs = [{ label: "선생님 관리", href: "/a/teachers" }];
    if (p[2] === "new") crumbs.push({ label: "선생님 등록" });
    else if (p[2] === "edit") crumbs.push({ label: "선생님 정보 수정" });
    else if (p[2]) crumbs.push({ label: `${names.teacher(p[2]) ?? "선생님"} 정보 수정` });
  } else if (p[0] === "t" && p[1] === "tmain") {
    crumbs = [{ label: "내 학생", href: "/t/tmain" }];
    if (p[2] === "new") crumbs.push({ label: "학생 등록" });
    else if (p[2]) crumbs.push(...studentTail(p.slice(3), `/t/tmain/${encodeURIComponent(p[2])}`, studentLabel(p[2])));
  } else if ((p[0] === "a" || p[0] === "t") && p[1] === "smain") {
    const home = p[0] === "a" ? { label: "관리자 메인", href: "/a/amain" } : { label: "내 학생", href: "/t/tmain" };
    crumbs = [home, ...studentTail(p.slice(2), `/${p[0]}/smain`, studentLabel(selectedStudentToken))];
  }

  return crumbs.length > 1 ? dropLastHref(crumbs) : [];
}
