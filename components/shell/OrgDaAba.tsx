"use client";
import { useEffect } from "react";
import { useT } from "@/hooks/i18n/useT";
import { setActiveOrg } from "@/app/actions/shell/setActiveOrg";
import {
  CHAVE_ALINHAMENTO, COOKIE_ORG_NOVA_DA_ABA, apagarCookieLegivel, gravarOrgDaAba,
  instalarFetchComOrgDaAba, lerCookieLegivel, lerOrgDaAba, ehOrgId,
} from "@/lib/auth/org-da-aba";
import { useOrganizationTransition } from "./OrganizationTransitionProvider";

// Antes de qualquer fetch da aba (hidratação, react-query, RSC do router).
if (typeof window !== "undefined") instalarFetchComOrgDaAba();

/**
 * Mantém a organização DESTA aba. Ver `lib/auth/org-da-aba.ts`.
 *
 * - aba sem escolha guardada: adota a org que o servidor renderizou;
 * - recarregou depois de outra aba trocar o cookie (renderizou a org errada):
 *   pede ao servidor, que valida o acesso, para realinhar o cookie e recarrega
 *   UMA vez; se o servidor recusar, adota a org renderizada.
 */
export function OrgDaAba({ orgId }: { orgId: string | null }) {
  const t = useT();
  const transition = useOrganizationTransition();
  useEffect(() => {
    instalarFetchComOrgDaAba();
    if (!orgId) return;
    const nova = lerCookieLegivel(COOKIE_ORG_NOVA_DA_ABA);
    if (nova) {
      apagarCookieLegivel(COOKIE_ORG_NOVA_DA_ABA);
      if (ehOrgId(nova) && nova === orgId) { gravarOrgDaAba(orgId); return; }
    }
    const daAba = lerOrgDaAba();
    if (!daAba || daAba === orgId) {
      gravarOrgDaAba(orgId);
      try { window.sessionStorage.removeItem(CHAVE_ALINHAMENTO); } catch { /* noop */ }
      return;
    }
    let jaTentou = false;
    try { jaTentou = window.sessionStorage.getItem(CHAVE_ALINHAMENTO) === daAba; } catch { /* noop */ }
    if (jaTentou) { gravarOrgDaAba(orgId); return; }
    try { window.sessionStorage.setItem(CHAVE_ALINHAMENTO, daAba); } catch { /* noop */ }
    transition.begin(t("Carregando organização…"));
    void setActiveOrg(daAba).then(
      (r) => {
        if (r.ok) { window.location.reload(); return; }
        gravarOrgDaAba(orgId); // acesso mudou: fica com a que o servidor mostra
        transition.cancel();
      },
      () => { transition.cancel(); },
    );
  }, [orgId, t, transition]);
  return null;
}
