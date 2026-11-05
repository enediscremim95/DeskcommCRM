import { z } from "zod";

import type { VitrineConfig, VitrinesConfig } from "@/lib/ai/guardrails-schema";
import type { InspecaoDeItemDoCatalogo } from "./send-catalog-item";

export const sendVitrineInputSchema = z
  .object({ assunto: z.string().regex(/^[a-z0-9_]{1,40}$/) })
  .strict();

export const INSTRUCAO_APOS_VITRINE =
  "As fotos já foram enviadas com título e valor. Não repita nome nem preço em texto e não envie nenhuma outra mensagem de apresentação; espere a resposta da cliente.";

type PapelDoTexto = "intro" | "fechamento";
type ResultadoDeEnvio =
  | { status: "sent" | "queued" | "duplicate_skipped" }
  | { status: "failed"; code: string; message: string };

interface ItemPlanejado {
  config: VitrineConfig["itens"][number];
  inspecao: Extract<InspecaoDeItemDoCatalogo, { status: "ready" }>;
}

/**
 * A camada semântica fiscaliza texto livre do modelo. Abertura e fechamento da
 * vitrine vêm da configuração aprovada da loja e, por isso, não chamam LLM.
 */
export function classificadorSemanticoParaMensagem<T>(
  origem: "modelo" | "texto_fixo_vitrine",
  classificador: T | undefined,
): T | undefined {
  return origem === "modelo" ? classificador : undefined;
}

export interface ItemMostradoNaVitrine {
  codigo: string;
  titulo: string;
  preco_resumo: string;
}

export async function executarVitrine(args: {
  input: z.infer<typeof sendVitrineInputSchema>;
  vitrines: VitrinesConfig;
  maxSendsRestantes: () => number;
  produtosJaEnviadosNoTurno: number;
  imagensJaEnviadasNoTurno: number;
  textoConsumiraEnvio: (body: string) => boolean;
  inspecionarItem: (
    item: VitrineConfig["itens"][number],
  ) => Promise<InspecaoDeItemDoCatalogo>;
  enviarTexto: (body: string, papel: PapelDoTexto) => Promise<ResultadoDeEnvio>;
  enviarItem: (
    item: VitrineConfig["itens"][number],
  ) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const { assunto } = sendVitrineInputSchema.parse(args.input);
  const vitrine = args.vitrines[assunto];
  if (!vitrine) {
    const validos = Object.keys(args.vitrines).sort();
    return {
      ok: false,
      error: {
        code: "assunto_desconhecido",
        message:
          validos.length > 0
            ? `assunto desconhecido. Use um destes: ${validos.join(", ")}.`
            : "nenhuma vitrine está configurada para este agente.",
      },
      assuntos_validos: validos,
    };
  }

  const prontos: ItemPlanejado[] = [];
  let jaEnviados = 0;
  for (const item of vitrine.itens) {
    const inspecao = await args.inspecionarItem(item);
    if (inspecao.status === "not_found") {
      return {
        ok: false,
        error: {
          code: "product_not_found",
          message: `o produto ${item.codigo} não está ativo nesta loja; nada foi enviado.`,
        },
      };
    }
    if (inspecao.status === "already_sent") {
      jaEnviados += 1;
      continue;
    }
    prontos.push({ config: item, inspecao });
  }

  if (prontos.length === 0 && jaEnviados === vitrine.itens.length) {
    return {
      ok: true,
      todos_ja_enviados: true,
      mostrados: [],
      instrucao: "Todos os produtos desta vitrine já foram enviados nesta conversa. Não repita e espere a resposta da cliente.",
    };
  }

  const custoIntro = vitrine.intro && args.textoConsumiraEnvio(vitrine.intro) ? 1 : 0;
  const custoFechamento =
    vitrine.fechamento && args.textoConsumiraEnvio(vitrine.fechamento) ? 1 : 0;
  const espacoFisico = args.maxSendsRestantes() - custoIntro - custoFechamento;
  const espacoDeImagens = Math.min(
    Math.max(0, espacoFisico),
    Math.max(0, 12 - args.imagensJaEnviadasNoTurno),
  );
  const vagasDeProduto = Math.max(0, 3 - args.produtosJaEnviadosNoTurno);
  const selecionados: ItemPlanejado[] = [];
  let imagensReservadas = 0;
  for (const item of prontos) {
    if (selecionados.length >= vagasDeProduto) break;
    const custoDoItem = item.config.fotos;
    if (imagensReservadas + custoDoItem > espacoDeImagens) break;
    selecionados.push(item);
    imagensReservadas += custoDoItem;
  }
  const cortado = selecionados.length < prontos.length;

  if (selecionados.length === 0) {
    return {
      ok: false,
      cortado_por_limite: true,
      error: {
        code: "max_sends_per_turn",
        message: "não há espaço para enviar um produto inteiro desta vitrine neste turno; nada foi enviado.",
      },
    };
  }

  if (vitrine.intro) {
    const intro = await args.enviarTexto(vitrine.intro, "intro");
    if (intro.status === "failed") {
      return { ok: false, error: { code: intro.code, message: intro.message } };
    }
  }

  const mostrados: ItemMostradoNaVitrine[] = [];
  for (const item of selecionados) {
    const resultado = await args.enviarItem(item.config);
    if (resultado.ok !== true) {
      return {
        ...resultado,
        mostrados,
        ...(cortado ? { cortado_por_limite: true } : {}),
      };
    }
    if (resultado.ja_enviado === true) continue;
    mostrados.push({
      codigo: item.config.codigo,
      titulo: item.config.titulo,
      preco_resumo: item.inspecao.precoResumo,
    });
  }

  if (vitrine.fechamento) {
    const fechamento = await args.enviarTexto(vitrine.fechamento, "fechamento");
    if (fechamento.status === "failed") {
      return {
        ok: false,
        error: { code: fechamento.code, message: fechamento.message },
        mostrados,
        ...(cortado ? { cortado_por_limite: true } : {}),
      };
    }
  }

  return {
    ok: true,
    todos_ja_enviados: false,
    mostrados,
    ...(cortado ? { cortado_por_limite: true } : {}),
    instrucao: INSTRUCAO_APOS_VITRINE,
  };
}
