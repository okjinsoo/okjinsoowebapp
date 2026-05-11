import RoleSmainRoutePage from "@/lib/ui/student/RoleSmainRoutePage";

export default async function StudentSmainCatchAllPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  return <RoleSmainRoutePage role="s" slug={slug} />;
}
