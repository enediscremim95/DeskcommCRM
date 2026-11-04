import type { AgentRow } from "@/hooks/ai/useAgent";

import { deriveAgentStatus } from "./AgentStatusBadge";

type Traduzir = (texto: string) => string;

export type EstadoOndeNoAr = "no_ar" | "automatico_desligado" | "desconectado" | "fora_do_ar";

export interface OndeNoAr {
  estado: EstadoOndeNoAr;
  tom: "success" | "warning" | "neutral";
  statusTexto: string;
  canalTexto: string | null;
  versaoTexto: string | null;
}

function formatarTelefone(telefone: string): string {
  const valor = telefone.trim();
  const digitos = valor.replace(/\D/g, "");
  const brasil = digitos.startsWith("55") ? digitos.slice(2) : digitos;

  if (brasil.length === 10 || brasil.length === 11) {
    const ddd = brasil.slice(0, 2);
    const inicio = brasil.slice(2, brasil.length - 4);
    const fim = brasil.slice(-4);
    return `+55 ${ddd} ${inicio}-${fim}`;
  }

  return valor;
}

function formatarData(data: string): string | null {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
  return partes ? `${partes[3]}/${partes[2]}` : null;
}

export function ondeNoAr(agent: AgentRow, t: Traduzir = (texto) => texto): OndeNoAr {
  const versao = agent.versao_publicada;
  const canal = versao?.canal ?? null;
  const statusDoAgente = deriveAgentStatus(agent);

  const canalTexto = versao
    ? canal?.phone_number?.trim()
      ? formatarTelefone(canal.phone_number)
      : canal?.display_name?.trim() || t("Canal não encontrado")
    : null;

  const publicadaEm = versao?.published_at ? formatarData(versao.published_at) : null;
  const versaoTexto =
    versao?.version_number != null
      ? publicadaEm
        ? `${t("versão")} ${versao.version_number}, ${t("publicada em")} ${publicadaEm}`
        : `${t("versão")} ${versao.version_number}`
      : null;

  if (statusDoAgente !== "published" || !versao) {
    return {
      estado: "fora_do_ar",
      tom: "neutral",
      statusTexto: t("Não está no ar"),
      canalTexto,
      versaoTexto,
    };
  }

  if (!canal) {
    return {
      estado: "fora_do_ar",
      tom: "neutral",
      statusTexto: t("Não está no ar"),
      canalTexto,
      versaoTexto,
    };
  }

  if (canal.status !== "WORKING") {
    return {
      estado: "desconectado",
      tom: "warning",
      statusTexto: t("Publicado, mas o número está desconectado"),
      canalTexto,
      versaoTexto,
    };
  }

  if (canal.automatic_attendance_enabled !== true) {
    return {
      estado: "automatico_desligado",
      tom: "warning",
      statusTexto: t("Publicado, mas o atendimento automático está desligado neste número"),
      canalTexto,
      versaoTexto,
    };
  }

  return {
    estado: "no_ar",
    tom: "success",
    statusTexto: t("No ar"),
    canalTexto,
    versaoTexto,
  };
}
