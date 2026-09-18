import type { CustomFieldDef } from "@/lib/schemas/settings";

const ROTULOS_CONHECIDOS: Record<string, string> = {
  imovel: "Imóvel de interesse",
  interesse: "Interesse",
  perfil: "Perfil",
  notas: "Notas",
  historico: "Histórico de atendimento",
  tarefa: "Tarefa",
  lembrete: "Lembrete",
  temperatura: "Temperatura",
  valor_proposta: "Valor da proposta",
  motivo_perda: "Motivo da perda",
  visita: "Visita",
  responsavel: "Responsável",
  tags: "Tags",
  ano: "Ano",
  modelo: "Modelo",
  situacao: "Situação",
  titularidade: "Titularidade",
  codigo: "Código",
  sdr: "SDR",
  status: "Status",
  form_preenchido: "Formulário preenchido",
  utm_source: "Origem da campanha",
  utm_medium: "Mídia da campanha",
  utm_campaign: "Campanha",
  utm_content: "Anúncio ou conteúdo",
  utm_term: "Termo da campanha",
  campaign_name: "Campanha",
  ad_name: "Anúncio",
  adset_name: "Conjunto de anúncios",
  webhook_source_id: "Fonte de captação",
  raw_phone: "Telefone informado",
};

function capitalizar(texto: string): string {
  if (!texto) return texto;
  return texto.charAt(0).toLocaleUpperCase("pt-BR") + texto.slice(1);
}

/** Rótulo do funil vence; chave desconhecida continua legível sem lista fixa. */
export function rotuloDoCampo(chave: string, definicoes: CustomFieldDef[] = []): string {
  const declarada = definicoes.find((campo) => campo.key === chave)?.label?.trim();
  if (declarada) return declarada;

  const normalizada = chave.trim().toLocaleLowerCase("pt-BR");
  if (ROTULOS_CONHECIDOS[normalizada]) return ROTULOS_CONHECIDOS[normalizada];

  const palavras = chave
    .replace(/([a-zá-ú])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("pt-BR");
  return capitalizar(palavras || chave);
}

export function valorLegivel(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "-";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  if (typeof valor === "number") return new Intl.NumberFormat("pt-BR").format(valor);
  if (Array.isArray(valor)) {
    return valor.map((item) => valorLegivel(item)).join(", ") || "-";
  }
  if (typeof valor === "object") return JSON.stringify(valor, null, 2);
  return String(valor);
}

/** `historico` migrado pode ser JSON textual; dado inválido segue visível como texto. */
export function historicoEstruturado(valor: unknown): unknown[] | null {
  let candidato = valor;
  if (typeof candidato === "string") {
    try {
      candidato = JSON.parse(candidato) as unknown;
    } catch {
      return null;
    }
  }
  return Array.isArray(candidato) ? candidato : null;
}
