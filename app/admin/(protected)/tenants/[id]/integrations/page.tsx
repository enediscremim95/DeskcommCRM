import { IntegrationsClient } from "./_client";

export default async function IntegrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <IntegrationsClient organizationId={id} />;
}
