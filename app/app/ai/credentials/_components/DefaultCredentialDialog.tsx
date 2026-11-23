"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import type { CredentialRow } from "@/hooks/ai/useCredentials";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { PlanoDeCredencial } from "@/lib/ai/credenciais/padrao";
import { PROVEDORES } from "@/lib/ai/pontos/provedores";
import { PONTO_POR_ID } from "@/lib/ai/pontos/registro";

export function DefaultCredentialDialog({ credential }: { credential: CredentialRow }) {
  const t = useT();
  const router = useRouter();
  const [plano, setPlano] = useState<PlanoDeCredencial | null>(null);
  const [modelo, setModelo] = useState("");
  const [pendente, setPendente] = useState(false);
  const endpoint = `/api/v1/ai/credentials/${credential.id}/default`;
  const nomeProvedor = (id: string) => PROVEDORES.find((p) => p.id === id)?.rotulo ?? id;

  async function abrir() {
    setPendente(true);
    try {
      const { data } = await apiClient.get<{ data: PlanoDeCredencial }>(endpoint);
      setModelo("");
      setPlano(data);
    } catch (error) {
      showApiError(error);
    } finally {
      setPendente(false);
    }
  }

  async function confirmar() {
    if (!plano || !modelo) return;
    setPendente(true);
    try {
      await apiClient.post(endpoint, { model_id: modelo, revision: plano.revision }, { noRetryOnTimeout: true });
      toast.success(t("Chave padrão atualizada."));
      router.refresh();
    } catch (error) {
      showApiError(error);
    } finally {
      setPlano(null);
      setPendente(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={abrir} disabled={pendente}>
        {t("Usar como padrão")}
      </Button>
      <Dialog open={plano !== null} onOpenChange={(open) => { if (!open && !pendente) setPlano(null); }}>
        {plano && (
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("Confirmar troca da chave padrão")}</DialogTitle>
              <DialogDescription>{nomeProvedor(plano.provider)} · {credential.label} · …{credential.api_key_last4}</DialogDescription>
            </DialogHeader>
            <label className="grid gap-2 text-sm">
              {t("Modelo da nova chave")}
              <select value={modelo} disabled={pendente} onChange={(event) => setModelo(event.target.value)}
                className="w-full rounded-md border bg-background p-2">
                <option value="">{t("Selecione um modelo")}</option>
                {plano.models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            {plano.models.length === 0 && <p className="text-sm">{t("Esta chave não tem modelos disponíveis com suporte a ferramentas no catálogo.")}</p>}
            <section className="space-y-2 text-sm">
              <h3 className="font-medium">{t("Vai mudar")}</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li>{t("Padrão da organização")} — {plano.current_provider && nomeProvedor(plano.current_provider)} {plano.current_model ?? "—"} → {modelo || "—"}</li>
                {plano.agents.map((agente) => (
                  <li key={agente.id}>
                    {agente.name} — {nomeProvedor(agente.provider)} / {agente.model} → {modelo || "—"} ({t("nova versão publicada")})
                    {agente.operator_model && <> · {t("Modelo do operador")}: {agente.operator_model} → {modelo || "—"}</>}
                  </li>
                ))}
                {plano.bindings.map((binding) => (
                  <li key={binding.id}>
                    {PONTO_POR_ID.get(binding.purpose)?.rotulo ?? binding.purpose} — {nomeProvedor(binding.provider)} / {binding.model} → {modelo || "—"}
                    {binding.has_custom_endpoint && <> · {t("Passa a usar o endereço oficial do fornecedor")}</>}
                    {!binding.is_enabled && <> ({t("configuração desativada")})</>}
                  </li>
                ))}
              </ul>
              <p>{t("Follow-ups redigidos pelo agente e classificações sem configuração própria passam a usar a nova chave e o novo modelo.")}</p>
            </section>
            <section className="space-y-2 text-sm">
              <h3 className="font-medium">{t("Fica como está")}</h3>
              <p>{t("Os fluxos de follow-up mantêm seus textos, prazos e configurações explícitas. Embeddings, transcrição e outros pontos fora da conversa mantêm suas configurações próprias.")}</p>
              {plano.retained.length > 0 && (
                <ul className="list-disc pl-5">
                  {plano.retained.map((purpose) => <li key={purpose}>{PONTO_POR_ID.get(purpose)?.rotulo ?? purpose}</li>)}
                </ul>
              )}
            </section>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlano(null)} disabled={pendente}>{t("Cancelar")}</Button>
              <Button onClick={confirmar} disabled={!modelo || pendente}>{t("Confirmar troca")}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
