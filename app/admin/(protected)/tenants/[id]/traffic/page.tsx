import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { TrafficDashboardAdmin } from "./_client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tráfego" };

export default async function TrafficDashboardAdminPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePlatformAdmin();
  const { id } = await params;
  return <TrafficDashboardAdmin organizationId={id} />;
}
