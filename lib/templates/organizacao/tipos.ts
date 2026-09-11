/**
 * O QUE É UM TEMPLATE DE ORGANIZAÇÃO — e, principalmente, o que ele NÃO é.
 *
 * ═══ O problema que ele resolve ═══════════════════════════════════════════
 *
 * Uma organização nasce com o funil de e-commerce que
 * `trg_seed_default_pipeline_for_org` semeia, um agente genérico, nenhuma
 * resposta pronta e nenhuma cadência. Quem entrega CRM a cliente como parte de
 * um serviço monta tudo isso à mão, cliente por cliente — e na vigésima vez
 * monta diferente da primeira, porque ninguém repete vinte configurações de
 * cabeça.
 *
 * ═══ A decisão de forma: configuração declarativa, nunca cópia de banco ═══
 *
 * O caminho óbvio seria "clonar a organização que ficou boa". Ele está recusado
 * de propósito, e a razão é de segurança, não de gosto: clonar uma organização
 * é um SELECT em tabelas que carregam contato, conversa, mensagem, tarefa,
 * agenda, log de auditoria, execução de fluxo, credencial de IA, sessão de
 * WhatsApp e webhook com segredo. Um template assim entrega dado de um cliente
 * para outro na primeira vez que alguém esquecer uma tabela da lista de
 * exclusão — e a lista de exclusão cresce a cada migration nova, sozinha, sem
 * ninguém ser avisado.
 *
 * Aqui é o contrário: o template só pode dizer o que este arquivo DECLARA. Uma
 * tabela nova no produto não entra no template por acidente, porque não existe
 * "copie o resto". Nada que identifique um cliente tem campo aqui para morar.
 *
 * ═══ A fronteira, explícita ═══════════════════════════════════════════════
 *
 * ENTRA: etapas do funil, vocabulário, campos do contato, motivos de perda,
 * tags de conversa, respostas prontas, instruções do atendente e cadências de
 * follow-up DESLIGADAS.
 *
 * NÃO ENTRA, e não tem como entrar: contato, negócio, conversa, mensagem,
 * tarefa, compromisso, credencial, chave de IA, canal de WhatsApp, webhook,
 * catálogo, documento da base de conhecimento, histórico e auditoria.
 *
 * Follow-up nasce DESLIGADO (`status: 'draft'`, sem versão publicada) por um
 * motivo concreto: uma cadência ativa num tenant recém-criado começaria a
 * mandar mensagem de WhatsApp em nome de um cliente que ainda não leu o texto.
 * Ligar é decisão de quem vai assinar a mensagem.
 */
import { z } from "zod";

import { customFieldSchema } from "@/lib/schemas/settings";
import { conversationTagSchema } from "@/lib/schemas/messaging";
import { PACOTES } from "@/lib/onboarding/pacotes-de-funil";

/**
 * O funil vem dos pacotes que o onboarding já usa, por id — não reescrito aqui.
 *
 * Duplicar as etapas neste arquivo criaria duas verdades sobre "o funil de
 * imobiliária": a do wizard e a do template. Elas divergiriam na primeira vez
 * que alguém melhorasse o nome de uma coluna em um dos dois lugares, e o dono
 * veria um funil diferente dependendo de por onde a organização passou.
 */
export const pacoteDeFunilIdSchema = z.enum(
  PACOTES.map((p) => p.id) as [string, ...string[]],
);

/** Uma resposta pronta da equipe (`message_templates` da organização). */
export const respostaRapidaSchema = z.strictObject({
  titulo: z.string().trim().min(1).max(120),
  corpo: z.string().trim().min(1).max(4000),
  /** O que a pessoa digita no inbox para puxar o texto. Sem "/" — o produto o adiciona. */
  atalho: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_-]+$/, "Use letras minúsculas, números, hífen e underscore")
    .optional(),
});
export type RespostaRapidaDoTemplate = z.infer<typeof respostaRapidaSchema>;

/**
 * Um passo de cadência: quanto esperar e o que mandar.
 *
 * A cadência é declarada como LISTA LINEAR e não como grafo porque é o formato
 * que se consegue revisar lendo — e porque o grafo é detalhe de armazenamento,
 * montado por `grafoDaCadencia()`. Um grafo escrito à mão aqui, com ids e
 * coordenadas de canvas, seria impossível de conferir numa revisão e quebraria
 * silenciosamente quando o schema do grafo ganhasse um campo.
 */
export const passoDaCadenciaSchema = z.strictObject({
  /** Espera antes de mandar esta mensagem. Mínimo de 5 minutos é limite do produto (`waitConfigSchema`). */
  esperarMinutos: z.number().int().min(5).max(129_600),
  texto: z.string().trim().min(1).max(4000),
});
export type PassoDaCadencia = z.infer<typeof passoDaCadenciaSchema>;

export const cadenciaSchema = z.strictObject({
  nome: z.string().trim().min(1).max(120),
  /** Por que ela existe. Vira a nota do nó final, para quem abrir o fluxo entender. */
  proposito: z.string().trim().min(1).max(200),
  passos: z.array(passoDaCadenciaSchema).min(1).max(10),
});
export type CadenciaDoTemplate = z.infer<typeof cadenciaSchema>;

/**
 * O atendente do nicho — só o texto, nunca o modelo nem a chave.
 *
 * Sem `provider`, `model` ou `credential_id` de propósito: esses três dizem
 * QUANTO o cliente gasta e COM QUAL conta. Um template que os trouxesse faria
 * cada organização nova nascer apontando para a chave de quem escreveu o
 * template, e a conta chegaria para ele.
 */
export const atendenteSchema = z.strictObject({
  nome: z.string().trim().min(1).max(80),
  instrucoes: z.string().trim().min(1).max(8000),
  /** As regras da casa, que vão para a memória da organização, não para o prompt. */
  regrasDaCasa: z.string().trim().min(1).max(4000).optional(),
});
export type AtendenteDoTemplate = z.infer<typeof atendenteSchema>;

export const templateDeOrganizacaoSchema = z.strictObject({
  id: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9-]*$/, "Use letras minúsculas, números e hífen"),
  /** Como quem vai aplicar reconhece o cliente nesta lista. */
  nome: z.string().trim().min(2).max(80),
  paraQuem: z.string().trim().min(4).max(200),
  pacoteDeFunil: pacoteDeFunilIdSchema,
  /** Como este nicho chama as coisas. Vai para `crm_pipelines.settings.vocabulary`. */
  vocabulario: z
    .strictObject({
      lead: z.string().trim().min(1).max(40).optional(),
      deal: z.string().trim().min(1).max(40).optional(),
      won: z.string().trim().min(1).max(40).optional(),
      lost: z.string().trim().min(1).max(40).optional(),
    })
    .optional(),
  campos: z.array(customFieldSchema).max(50).default([]),
  motivosDePerda: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  tagsDeConversa: z.array(conversationTagSchema).max(50).default([]),
  respostasRapidas: z.array(respostaRapidaSchema).max(50).default([]),
  atendente: atendenteSchema,
  cadencias: z.array(cadenciaSchema).max(10).default([]),
});
export type TemplateDeOrganizacao = z.infer<typeof templateDeOrganizacaoSchema>;
