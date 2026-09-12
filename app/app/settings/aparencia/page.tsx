import { requireAuth } from "@/lib/auth/server";
import { AppearanceSettings } from "@/components/theme/appearance-settings";
export const dynamic = "force-dynamic";
export default async function AppearancePage() {
  await requireAuth();
  return <AppearanceSettings />;
}
