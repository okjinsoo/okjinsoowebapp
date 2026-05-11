import RoleSmainRoutePage from "@/lib/ui/student/RoleSmainRoutePage";

export default async function AdminSmainCatchAllPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  return <RoleSmainRoutePage role="a" slug={slug} />;
}
