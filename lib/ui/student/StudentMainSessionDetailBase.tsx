// v1/lib/ui/student/StudentMainSessionDetailBase.tsx
"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  buildSmainBasePath,
  buildSmainSessionDetailPath,
  buildSmainSessionDetailPathWithToken,
} from "@/lib/routes/appRouteBuilder";
import SessionTopBarCore from "@/lib/ui/session/SessionTopBarCore";
import SessionClientCore from "@/lib/ui/session/SessionClientCore";
import RoleGateCard from "@/lib/ui/common/RoleGateCard";
import useRoleScopedSelection from "@/lib/ui/student/hooks/useRoleScopedSelection";

export default function StudentMainSessionDetailBase({ role }: { role: "a" | "t" | "s" }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const index = useMemo(() => {
    const parts = (pathname ?? "").split("/").filter(Boolean);
    const tail = parts.at(-1) ?? "";
    if (!/^\d+$/.test(tail)) return NaN;
    return Number(tail);
  }, [pathname]);
  const queryToken = (searchParams?.get("token") ?? "").trim();
  const {
    studentToken: token,
    students,
    teachers,
    teacherId,
    setStudentToken: setToken,
    setTeacherId,
  } = useRoleScopedSelection({
    role,
    preferredStudentToken: queryToken || null,
  });
  const smainBasePath = buildSmainBasePath(role);

  return (
    <main>
      <div style={{ padding: 20 }}>
        <RoleGateCard
          role={role}
          teachers={teachers}
          students={students}
          teacherId={teacherId}
          studentToken={token}
          onTeacherChange={(next) => setTeacherId(next)}
          onStudentChange={(next) => {
            setToken(next);
            if (Number.isFinite(index)) {
              const href = next
                ? buildSmainSessionDetailPathWithToken({
                    role,
                    sessionIndex: index,
                    studentToken: next,
                  })
                : buildSmainSessionDetailPath({
                    role,
                    sessionIndex: index,
                  });
              router.push(href);
            }
          }}
        />
      </div>

      <div className="p-6 space-y-4">
        <div>
          <button onClick={() => router.push(smainBasePath)} className="btn btn-bold">
            학생 정보
          </button>
        </div>
        {token && Number.isFinite(index) ? (
          <SessionClientCore
            key={`${token}-${index}`}
            role={role}
            token={token}
            sessionIndex={index}
            headerSlot={<SessionTopBarCore role={role} token={token} index={index} />}
          />
        ) : (
          <div style={{ color: "var(--text-muted)" }}>학생을 먼저 선택해주세요.</div>
        )}
      </div>
    </main>
  );
}
