import RoleSmainRoutePage from "@/lib/ui/student/RoleSmainRoutePage";

export default async function TeacherSmainCatchAllPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  return <RoleSmainRoutePage role="t" slug={slug} />;
}
