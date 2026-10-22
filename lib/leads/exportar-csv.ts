import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";

const FUSO_EXPORTACAO = "America/Sao_Paulo";

export const CABECALHO_EXPORTACAO_LEADS = [
  "nome",
  "telefone",
  "email",
  "etapa",
  "situacao",
  "motivo_perda",
  "detalhe_perda",
  "origem",
  "criado_em",
  "ultima_atividade",
  "etiquetas",
  "respostas_e_campos",
] as const;

export interface LeadParaExportacao {
  created_at: string;
  custom_fields: unknown;
  last_activity_at: string | null;
  lost_reason: string | null;
  lost_reason_detail?: string | null;
  source: string | null;
  status: string;
  tags: string[] | null;
  contato: {
    display_name: string | null;
    email: string | null;
    name: string | null;
    phone_number: string | null;
  } | null;
  etapa: { name: string } | null;
}

function partesDaData(data: Date): Record<string, string> {
  return Object.fromEntries(
    // O formato do arquivo (DD/MM/AAAA HH:MM em São Paulo) é fixo de propósito, para o Excel
    // brasileiro; o idioma abaixo só entrega as partes numéricas, não define o formato.
    new Intl.DateTimeFormat("en-GB", {
      timeZone: FUSO_EXPORTACAO,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(data)
      .map((parte) => [parte.type, parte.value]),
  );
}

export function formatarDataDaExportacao(valor: string | null): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = partesDaData(data);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

export function dataDoArquivo(data: Date): string {
  const p = partesDaData(data);
  return `${p.year}-${p.month}-${p.day}`;
}

export function slugSeguroParaArquivo(slug: string): string {
  const seguro = slug
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return seguro || "organizacao";
}

function valorLegivel(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

function valorNaoVazio(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "string") return valor.trim() !== "";
  if (Array.isArray(valor)) return valor.length > 0;
  if (typeof valor === "object") return Object.keys(valor).length > 0;
  return true;
}

export function respostasECampos(customFields: unknown): string {
  if (!customFields || typeof customFields !== "object" || Array.isArray(customFields)) return "";
  return Object.entries(customFields)
    .filter(([, valor]) => valorNaoVazio(valor))
    .sort(([chaveA], [chaveB]) => chaveA.localeCompare(chaveB, "pt-BR"))
    .map(([chave, valor]) => `${chave}: ${valorLegivel(valor)}`)
    .join(" | ");
}

/** Neutraliza fórmulas antes de aplicar o escape estrutural do CSV. */
export function escaparCelulaCsv(valor: unknown): string {
  let texto = valor === null || valor === undefined ? "" : String(valor);
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`;
  if (/[";\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

export function montarCsvDeLeads(leads: LeadParaExportacao[]): string {
  const linhas = [CABECALHO_EXPORTACAO_LEADS.join(";")];

  for (const lead of leads) {
    const nome = rotuloDoContato(lead.contato);
    linhas.push(
      [
        nome,
        lead.contato?.phone_number,
        lead.contato?.email,
        lead.etapa?.name,
        lead.status,
        lead.lost_reason,
        lead.lost_reason_detail,
        lead.source,
        formatarDataDaExportacao(lead.created_at),
        formatarDataDaExportacao(lead.last_activity_at),
        (lead.tags ?? []).join(" | "),
        respostasECampos(lead.custom_fields),
      ]
        .map(escaparCelulaCsv)
        .join(";"),
    );
  }

  return `\uFEFF${linhas.join("\r\n")}\r\n`;
}
