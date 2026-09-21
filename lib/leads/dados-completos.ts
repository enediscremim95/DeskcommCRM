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

/**
 * Como um valor de texto deve ser exibido na ficha. O que muda é só a quebra:
 * e-mail, endereço e código não têm espaço para o navegador quebrar em ponto
 * sensato, então vão numa linha só (com o valor inteiro no tooltip e no botão
 * de copiar) em vez de partirem letra a letra num painel estreito.
 */
export type ApresentacaoDoValor = "texto" | "email" | "url" | "codigo";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_ABSOLUTA = /^https?:\/\/\S+$/i;

export function apresentacaoDoValor(texto: string): ApresentacaoDoValor {
  const limpo = texto.trim();
  if (EMAIL.test(limpo)) return "email";
  if (URL_ABSOLUTA.test(limpo)) return "url";
  if (limpo.length >= 20 && !/\s/.test(limpo)) return "codigo";
  return "texto";
}

export interface LinhaDeNota {
  rotulo?: string;
  valor: string;
}

/**
 * Nota que chegou como texto corrido ("E-mail: x · Origem: y") vira uma linha
 * por informação, sem parser esperto: só separa no " · " e na quebra de linha
 * e reconhece o "Rótulo: valor" quando ele é curto e inequívoco. Nada some —
 * o trecho que não casa continua inteiro na própria linha. Devolve `null`
 * quando não há o que separar, e a ficha mostra o texto como veio.
 */
export function linhasDaNota(texto: string): LinhaDeNota[] | null {
  const partes = texto
    .split(/\s*[·•|]\s*|\r?\n+/)
    .map((parte) => parte.trim())
    .filter(Boolean);
  if (partes.length < 2) return null;

  return partes.map((parte) => {
    const par = /^([^:]{1,32}?):\s+(.+)$/s.exec(parte);
    const rotulo = par?.[1]?.trim();
    const valor = par?.[2]?.trim();
    if (!rotulo || !valor || URL_ABSOLUTA.test(parte)) return { valor: parte };
    return { rotulo, valor };
  });
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
