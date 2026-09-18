import { ManagedConnectorAdminForm } from "./_form";

export default async function TenantWhatsappPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManagedConnectorAdminForm organizationId={id} />;
}
