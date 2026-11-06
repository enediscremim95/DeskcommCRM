import type { VitrineConfig, VitrinesConfig } from "@/lib/ai/guardrails-schema";

const NEGACOES = new Set(["nao", "sem", "nunca", "deixa", "nada"]);
const POSSE_EXISTENTE = new Set(["tenho", "temos"]);
const SUJEITOS_DE_POSSE = new Set([
  "ela",
  "ele",
  "mae",
  "meu",
  "meus",
  "minha",
  "minhas",
  "pai",
  "sogra",
  "sogro",
  "avo",
  "vovo",
]);

function palavrasNormalizadas(texto: string): string[] {
  return (
    texto
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase("pt-BR")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function janelaBloqueiaGatilho(palavras: readonly string[], inicio: number): boolean {
  const anteriores = palavras.slice(Math.max(0, inicio - 4), inicio);
  if (anteriores.some((palavra) => NEGACOES.has(palavra))) return true;
  if (POSSE_EXISTENTE.has(anteriores.at(-1) ?? "")) return true;

  // "Minha sogra tem louça" nomeia o produto, mas descreve posse existente,
  // não interesse de compra. A pergunta "tem louça?" continua elegível porque
  // não traz um sujeito de posse antes do verbo.
  const indiceTem = anteriores.lastIndexOf("tem");
  return indiceTem >= 0 && anteriores.slice(0, indiceTem).some((p) => SUJEITOS_DE_POSSE.has(p));
}

/**
 * Comparação literal por palavras. Pontuação, caixa e acento não mudam o
 * resultado; fragmentos de palavra nunca casam e nenhum texto da configuração
 * é compilado como regex.
 */
export function mensagemContemGatilho(texto: string, gatilho: string): boolean {
  const palavras = palavrasNormalizadas(texto);
  const alvo = palavrasNormalizadas(gatilho);
  if (alvo.length === 0 || alvo.length > palavras.length) return false;

  for (let inicio = 0; inicio <= palavras.length - alvo.length; inicio += 1) {
    const casou = alvo.every(
      (palavra, deslocamento) => palavras[inicio + deslocamento] === palavra,
    );
    if (casou && !janelaBloqueiaGatilho(palavras, inicio)) return true;
  }
  return false;
}

export type ResultadoVitrinePorGatilho =
  | { status: "desligada" | "sem_ferramenta" | "atendimento_humano" | "sem_assunto_novo" }
  | {
      status: "executada";
      assunto: string;
      ok: boolean;
      produtosMostrados: number;
    };

export async function executarVitrinePorGatilho(args: {
  ativa: boolean;
  ferramentaDisponivel: boolean;
  vitrines: VitrinesConfig;
  mensagensDoCliente: readonly string[];
  assuntosChamadosNesteTurno: ReadonlySet<string>;
  emAtendimentoHumano: () => Promise<boolean>;
  assuntoJaMostrado: (assunto: string, vitrine: VitrineConfig) => Promise<boolean>;
  executar: (assunto: string) => Promise<Record<string, unknown>>;
  log: { info: (message: string, fields: Record<string, unknown>) => void };
  registrarRastro?: (rastro: { assunto: string; ok: boolean; produtosMostrados: number }) => void;
}): Promise<ResultadoVitrinePorGatilho> {
  if (!args.ativa) return { status: "desligada" };
  if (!args.ferramentaDisponivel) return { status: "sem_ferramenta" };
  if (await args.emAtendimentoHumano()) return { status: "atendimento_humano" };

  for (const [assunto, vitrine] of Object.entries(args.vitrines)) {
    const gatilhos = vitrine.gatilhos ?? [];
    if (gatilhos.length === 0) continue;
    if (
      !args.mensagensDoCliente.some((mensagem) =>
        gatilhos.some((g) => mensagemContemGatilho(mensagem, g)),
      )
    ) {
      continue;
    }
    if (args.assuntosChamadosNesteTurno.has(assunto)) continue;
    if (await args.assuntoJaMostrado(assunto, vitrine)) continue;

    const resultado = await args.executar(assunto);
    const mostrados = Array.isArray(resultado.mostrados) ? resultado.mostrados.length : 0;
    const ok = resultado.ok === true;
    const rastro = { assunto, ok, produtosMostrados: mostrados };
    args.log.info("vitrine_por_gatilho executada no fim do turno", {
      assunto,
      mensagens_avaliadas: args.mensagensDoCliente.length,
      gatilhos_configurados: gatilhos.length,
      produtos_configurados: vitrine.itens.length,
      produtos_mostrados: mostrados,
    });
    args.registrarRastro?.(rastro);
    return { status: "executada", ...rastro };
  }

  return { status: "sem_assunto_novo" };
}
