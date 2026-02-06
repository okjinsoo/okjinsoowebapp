import SessionTopBarCore from "@/lib/ui/session/SessionTopBarCore";
import SessionClientCore from "@/lib/ui/session/SessionClientCore";

export default async function TeacherSessionDetailPage({
  params,
}: {
  params: Promise<{ token: string; index: string }>;
}) {
  const { token, index } = await params;
  const sessionIndex = Number(index);

  return (
    <div className="p-6 space-y-4">
      <SessionClientCore
        role="t"
        token={token}
        sessionIndex={sessionIndex}
        headerSlot={<SessionTopBarCore role="t" token={token} index={sessionIndex} />}
      />
    </div>
  );
}
