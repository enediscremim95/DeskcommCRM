"use client";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useRetryOwnerAccess, type OwnerAccess } from "@/hooks/useCreateTenant";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useT } from "@/hooks/i18n/useT";
import { toast } from "sonner";

/** A falha continua visível depois de fechar a tela de criação. */
export function OwnerAccessStatus({ tenantId }: { tenantId: string }) {
  const t = useT();
  const retry = useRetryOwnerAccess();
  const access = useQuery({
    queryKey: ["admin", "tenants", tenantId, "owner-access"],
    queryFn: () => apiClient.get<{ data: { owner_access: OwnerAccess | null } }>(
      `/api/v1/admin/tenants/${tenantId}/owner-access`,
    ),
  });
  if (access.isPending) return <p role="status">{t("Conferindo envio do acesso...")}</p>;
  if (access.isError) return <div role="alert" className="space-y-2">
    <p>{t("Não foi possível conferir o envio do acesso.")}</p>
    <Button variant="outline" onClick={() => void access.refetch()}>{t("Tentar novamente")}</Button>
  </div>;
  const state = access.data.data.owner_access;
  if (!state) return null;
  return <Card>
    <CardHeader><CardTitle>{t("Acesso do responsável")}</CardTitle></CardHeader>
    <CardContent className="space-y-3" aria-live="polite">
      <p>{state.status === "failed"
        ? t("O envio do acesso falhou. Tente novamente sem criar outra organização.")
        : state.status === "existing_user"
          ? t("O responsável já tem conta e mantém sua senha. Confira o convite na equipe da organização.")
          : t("O serviço de e-mail aceitou o envio do acesso. Peça ao responsável para conferir a caixa de entrada e o spam.")}</p>
      <a className="break-all underline" href={state.login_url}>{state.login_url}</a>
      {state.retryable && <Button className="block" disabled={retry.isPending} onClick={async () => {
        try {
          await retry.mutateAsync(tenantId);
          await access.refetch();
        } catch {
          toast.error(t("Não foi possível enviar o acesso. Tente novamente."));
        }
      }}>{retry.isPending ? t("Enviando...") : t("Tentar enviar acesso novamente")}</Button>}
    </CardContent>
  </Card>;
}
