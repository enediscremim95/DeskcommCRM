/**
 * DO TEMPLATE DECLARATIVO PARA O QUE O BANCO RECEBE.
 *
 * Tudo aqui é função PURA: entra template, sai jsonb. Nenhuma consulta, nenhum
 * `organization_id`, nenhum cliente do Supabase. É deliberado — é o que permite
 * testar o conteúdo de um template (o grafo fecha? o slug colide? a etapa de
 * ganho é uma só?) sem banco nenhum, e é o que garante que nada daqui possa
 * LER de uma organização enquanto escreve em outra: uma função que não recebe
 * organização não tem como vazar dado entre duas.
 *
 * A montagem do grafo de follow-up vive aqui, e não no catálogo, porque grafo é
 * formato de armazenamento: ids de nó, coordenadas de canvas e arestas não são
 * informação que alguém revisa quando discute o texto de uma cadência.
 */
import type { FlowGraph, FlowEdge, FlowNode } from "@/lib/followup/graph-schema";
import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";
import { etapasParaGravar } from "@/lib/onboarding/proposta-de-funil";
import { slugDeNome } from "@/lib/leads/stage-editing";

import type { CadenciaDoTemplate, TemplateDeOrganizacao } from "./tipos";

/** Espaçamento do canvas. Só estética de quem abre o fluxo na tela. */
const PASSO_X = 240;

/**
 * A cadência virada grafo linear: disparo, espera, mensagem, espera, mensagem, fim.
 *
 * Sai sempre LINEAR e sempre com `{ type: 'always' }` nas arestas. Um template
 * não é o lugar de ramificar por classificação de IA: ramo exige texto para
 * cada saída, e texto para saída que ninguém revisou é mensagem errada mandada
 * em nome do cliente. Quem quiser ramificar abre o construtor e ramifica — o
 * rascunho já está lá, desenhado e desligado.
 *
 * O nó final fecha com `outcome: 'exhausted'`, não `'converted'`: a cadência
 * chegar ao fim significa que as mensagens acabaram, não que a pessoa comprou.
 * Marcar conversão aqui poluiria a estatística de resultado do fluxo com todo
 * mundo que simplesmente não respondeu.
 */
export function grafoDaCadencia(cadencia: CadenciaDoTemplate): FlowGraph {
  const nodes: FlowNode[] = [
    {
      id: "inicio",
      type: "trigger",
      label: "Entrou na cadência",
      position: { x: 0, y: 0 },
      config: {},
    },
  ];
  const edges: FlowEdge[] = [];
  let anterior = "inicio";
  let coluna = 1;

  cadencia.passos.forEach((passo, i) => {
    const espera = `espera-${i + 1}`;
    const mensagem = `mensagem-${i + 1}`;

    nodes.push({
      id: espera,
      type: "wait",
      label: rotuloDaEspera(passo.esperarMinutos),
      position: { x: coluna * PASSO_X, y: 0 },
      config: { mode: "fixed", duration_ms: passo.esperarMinutos * 60_000 },
    });
    edges.push({
      id: `${anterior}-${espera}`,
      source: anterior,
      target: espera,
      priority: 0,
      condition: { type: "always" },
    });
    coluna += 1;

    nodes.push({
      id: mensagem,
      type: "action",
      label: `Mensagem ${i + 1}`,
      position: { x: coluna * PASSO_X, y: 0 },
      config: { mode: "text", body: passo.texto },
    });
    edges.push({
      id: `${espera}-${mensagem}`,
      source: espera,
      target: mensagem,
      priority: 0,
      condition: { type: "always" },
    });
    coluna += 1;
    anterior = mensagem;
  });

  nodes.push({
    id: "fim",
    type: "end",
    label: "Fim",
    position: { x: coluna * PASSO_X, y: 0 },
    config: { outcome: "exhausted", note: cadencia.proposito.slice(0, 200) },
  });
  edges.push({
    id: `${anterior}-fim`,
    source: anterior,
    target: "fim",
    priority: 0,
    condition: { type: "always" },
  });

  return { nodes, edges };
}

/** "2 dias", "3 horas", "30 minutos" — o rótulo que o nó mostra no canvas. */
function rotuloDaEspera(minutos: number): string {
  if (minutos % 1440 === 0) {
    const dias = minutos / 1440;
    return dias === 1 ? "Esperar 1 dia" : `Esperar ${dias} dias`;
  }
  if (minutos % 60 === 0) {
    const horas = minutos / 60;
    return horas === 1 ? "Esperar 1 hora" : `Esperar ${horas} horas`;
  }
  return `Esperar ${minutos} minutos`;
}

/**
 * O que a função do banco recebe. Chaves em snake_case porque é jsonb que o
 * plpgsql vai ler com `->>`, e um `p_payload->>'respostasRapidas'` escrito em
 * camelCase é o tipo de divergência que só aparece em produção.
 */
export interface PayloadDoTemplate {
  template_id: string;
  funil: {
    nome: string;
    slug: string;
    etapas: {
      nome: string;
      slug: string;
      position: number;
      is_won: boolean;
      is_lost: boolean;
      /**
       * `null` é possível no tipo de origem e a função do banco já o trata
       * (`nullif`). Estreitar para `string` aqui mentiria sobre o contrato e
       * esconderia o dia em que um pacote de funil viesse sem destino — que é
       * justamente o caso que deixa o assistente mudo.
       */
      agent_stage_hint: string | null;
    }[];
  };
  /**
   * `vocabulary` é COLUNA própria de `crm_pipelines`, e `fields`/`lost_reasons`
   * moram no jsonb `settings`. Separados aqui porque separados lá: juntá-los num
   * objeto só faria a função do banco adivinhar o que é coluna e o que é chave.
   */
  vocabulario_do_funil: Record<string, string>;
  settings_do_funil: {
    fields: unknown[];
    lost_reasons: string[];
  };
  tags_de_conversa: string[];
  respostas_rapidas: { titulo: string; corpo: string; atalho: string | null }[];
  atendente: { nome: string; instrucoes: string; regras_da_casa: string | null };
  cadencias: { nome: string; proposito: string; graph: FlowGraph }[];
}

/**
 * Traduz o template no payload, com o funil já resolvido a partir do pacote.
 *
 * `slugsDeFunilJaUsados` entra como PARÂMETRO e não é descoberto aqui porque
 * descobrir exigiria consultar a organização — e esta camada não fala com o
 * banco de propósito. Quem chama já leu os funis da organização para outra
 * coisa; passar a lista custa nada e mantém a função testável.
 */
export function payloadDoTemplate(
  template: TemplateDeOrganizacao,
  slugsDeFunilJaUsados: string[] = [],
): PayloadDoTemplate {
  const pacote = PACOTES.find((p) => p.id === template.pacoteDeFunil);
  if (!pacote) {
    // Inalcançável pelo schema (`pacoteDeFunilIdSchema` é derivado de PACOTES),
    // e explícito porque o dia em que alguém renomear um pacote este erro é a
    // diferença entre uma falha de build legível e um funil sem colunas.
    throw new Error(
      `template "${template.id}" aponta para o pacote de funil "${template.pacoteDeFunil}", que não existe`,
    );
  }

  return {
    template_id: template.id,
    funil: {
      nome: pacote.proposta.nome,
      slug: slugDeNome(pacote.proposta.nome, slugsDeFunilJaUsados, "funil"),
      etapas: etapasParaGravar(pacote.proposta, slugDeNome).map((e) => ({
        nome: e.nome,
        slug: e.slug,
        position: e.position,
        is_won: e.is_won,
        is_lost: e.is_lost,
        agent_stage_hint: e.agent_stage_hint,
      })),
    },
    vocabulario_do_funil: template.vocabulario ? semVazios(template.vocabulario) : {},
    settings_do_funil: {
      fields: template.campos,
      lost_reasons: template.motivosDePerda,
    },
    tags_de_conversa: template.tagsDeConversa,
    respostas_rapidas: template.respostasRapidas.map((r) => ({
      titulo: r.titulo,
      corpo: r.corpo,
      atalho: r.atalho ?? null,
    })),
    atendente: {
      nome: template.atendente.nome,
      instrucoes: template.atendente.instrucoes,
      regras_da_casa: template.atendente.regrasDaCasa ?? null,
    },
    cadencias: template.cadencias.map((c) => ({
      nome: c.nome,
      proposito: c.proposito,
      graph: grafoDaCadencia(c),
    })),
  };
}

/** Chave com valor vazio em `vocabulary` apagaria o rótulo do produto. Fora. */
function semVazios(obj: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).filter((par): par is [string, string] => !!par[1]),
  );
}
