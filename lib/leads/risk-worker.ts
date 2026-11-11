import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { registraFalhaDeAtividade } from "@/lib/leads/activity-write-failure";
import { calculaBucketsAtuais, type EstadoCalculado } from "@/lib/leads/risk-seed";
import { propoeReativacao } from "@/lib/leads/reactivation";
import type { RiskBucket } from "@/lib/leads/risk-radar";
import type { ActivityType } from "@/lib/leads/activity-vocabulary";
import { logger } from "@/lib/logger";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";

/**
 * O OBSERVADOR DA TRAVESSIA — a peça que faz "esfriando" acontecer sem ninguém
 * abrir tela nenhuma.
 *
 * Antes desta wave, `classifyRisk` só rodava dentro de rotas de LEITURA: o
 * estado não existia até alguém olhar. Um radar que só enxerga quando observado
 * não é mecanismo anti-morte — é a mesma morte, com testemunha opcional.
 *
 * ⚠️ O ESTADO SÓ É REESCRITO QUANDO O BUCKET MUDA. É a contrapartida que a 0078
 * pediu e que o banco não consegue garantir: a tabela está DENTRO da publicação
 * de realtime, então um `update` que só refresque `detected_at` publicaria
 * evento sem mudança de estado e o board voltaria a piscar à toa — o defeito
 * que a separação toda existe para impedir.
 *
 * ⚠️ A TIMELINE É MAIS ESTREITA QUE O BUCKET. "Negócio esfriou" entra uma vez
 * por episódio de parada (`em_risco` ou `critico`). Passar de um para o outro,
 * ou o worker rodar de novo enquanto o negócio segue parado, não gera outra
 * linha. Voltar por `em_voo` (agenda, follow-up) e cair de novo em parada abre
 * episódio novo: o estado anterior existe e a transição é real. A timeline só
 * é consultada quando o estado anterior não foi lido (`de = null`) — senão uma
 * página cortada regravaria o mesmo esfriamento.
 *
 * A leitura do estado gravado pagina. O PostgREST deste repo corta em 1000
 * linhas (`supabase/config.toml`, `max_rows`). Sem `range`, toda passada via
 * só a primeira página: o restante parecia `de = null` e a timeline ganhava
 * outro "esfriou" a cada ciclo, com o upsert regravando o mesmo bucket.
 *
 * ⚠️ E NÃO TOCA `crm_leads`. Nem por escrita direta, nem pelo trigger: as
 * atividades que ele emite (`lead_cooled`, `lead_reactivated`) estão FORA da
 * lista positiva da 0079, então não carimbam `last_activity_at`. É por isso que
 * o produtor não se autodestrói, e é por isso que o arrasto em voo do usuário
 * não é invalidado por um worker rodando em segundo plano (o 409 fantasma).
 */

export interface ResultadoDaObservacao {
  avaliados: number;
  travessias: number;
  esfriaram: number;
  reativaram: number;
  /** Mudanças de bucket que não merecem linha na timeline (ver `narra`). */
  silenciosas: number;
  falhasDeAtividade: number;
  /** Propostas de reativação criadas nesta passada. */
  propostas: number;
  /**
   * Travessia que pediria "esfriou" de novo, mas o episódio atual já está na
   * timeline. O estado pode mudar (em risco → crítico); a linha, não.
   */
  esfriamentosJaRegistrados: number;
}

/**
 * O que a travessia CONTA para um humano — e o que ela não conta.
 *
 * `null` significa "mude o estado, mas não escreva na timeline". Nem toda
 * mudança de bucket é acontecimento: entrar em `em_voo` é a IA ter agendado
 * retorno, e isso já é registrado por quem agendou. Duplicar viraria duas linhas
 * para um evento só, e a timeline passa a parecer que o sistema fala sozinho.
 */
/**
 * Interação que zera o relógio do silêncio (`fn_update_last_activity_at`, lista
 * positiva — inclusive `voice_call`) mais `lead_reactivated`, que é o próprio
 * worker dizendo que o negócio voltou a andar. O script de limpeza usa a mesma
 * lista. Ele também abre episódio novo quando dois esfriamentos do mesmo lead
 * ficam separados por pelo menos o intervalo configurado (padrão 1 hora).
 * Intervalo menor mantém mais frases. As repetições do defeito saem a cada
 * passada, cerca de 15 minutos. Frase cujo payload diz que o estado anterior
 * foi lido (`em_voo` ou `em_dia`) também fica.
 */
export const TIPOS_QUE_ENCERRAM_ESFRIAMENTO = [
  "ai_turn",
  "note",
  "lead_edited",
  "stage_changed",
  "next_action_approved",
  "voice_call",
  "lead_reactivated",
] as const;

export function bucketParado(bucket: RiskBucket | null): boolean {
  return bucket === "em_risco" || bucket === "critico";
}

function narrar(
  de: RiskBucket | null,
  para: RiskBucket,
): { tipo: ActivityType; reason: string } | null {
  if (de === para) return null;
  // Entrar na parada — vindo de em dia, em voo ou de estado que a passada não
  // enxergou. Trocar `em_risco` por `critico` (ou o contrário) NÃO é outro
  // esfriamento: o negócio não voltou a andar no meio. O radar continua
  // mostrando o bucket novo; a timeline fica com a primeira frase.
  if (bucketParado(para) && !bucketParado(de)) {
    return {
      tipo: "lead_cooled",
      reason:
        para === "critico"
          ? "Parado há muito tempo — sem resposta"
          : "Sem resposta além do prazo deste estágio",
    };
  }
  if (para === "em_dia" && de !== null && de !== "em_dia") {
    return { tipo: "lead_reactivated", reason: "Voltou a ter movimento" };
  }
  return null;
}

/**
 * O episódio atual já tem linha na timeline quando o `lead_cooled` mais recente
 * não foi seguido de interação nem de reativação. Só vale quando o estado
 * anterior não foi lido: com estado gravado, a transição decide.
 *
 * O desempate é `(performed_at, id)`, o mesmo do script de limpeza. Dois fatos
 * no mesmo instante ficam na ordem do id.
 */
export async function episodioDeEsfriamentoAberto(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string,
): Promise<boolean> {
  const ultimo = await admin
    .from("crm_lead_activities")
    .select("id, performed_at")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("type", "lead_cooled")
    .order("performed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultimo.error) throw new Error(ultimo.error.message);
  const linha = ultimo.data as { id: string; performed_at: string } | null;
  if (!linha?.performed_at) return false;

  const posterior = await admin
    .from("crm_lead_activities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .in("type", [...TIPOS_QUE_ENCERRAM_ESFRIAMENTO])
    .gt("performed_at", linha.performed_at)
    .order("performed_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (posterior.error) throw new Error(posterior.error.message);
  if (posterior.data) return false;

  if (!linha.id) return true;
  const mesmoInstante = await admin
    .from("crm_lead_activities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .in("type", [...TIPOS_QUE_ENCERRAM_ESFRIAMENTO])
    .eq("performed_at", linha.performed_at)
    .gt("id", linha.id)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (mesmoInstante.error) throw new Error(mesmoInstante.error.message);
  return !mesmoInstante.data;
}

/**
 * A frase desta versão do estado já está na timeline. `detected_at` é o
 * instante em que o banco gravou o bucket que ainda está salvo. Uma atividade
 * do mesmo tipo a partir dali significa que a frase entrou e o upsert do
 * estado falhou: a passada seguinte só corrige o estado, não escreve de novo.
 * `em_voo` tem `detected_at` posterior ao esfriamento anterior, então a volta
 * à parada ainda grava.
 */
async function atividadeJaEscritaNestaDeteccao(
  admin: SupabaseClient,
  organizationId: string,
  leadId: string,
  tipo: ActivityType,
  detectedAt: string,
): Promise<boolean> {
  const achado = await admin
    .from("crm_lead_activities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("lead_id", leadId)
    .eq("type", tipo)
    .gte("performed_at", detectedAt)
    .limit(1)
    .maybeSingle();
  if (achado.error) throw new Error(achado.error.message);
  return Boolean(achado.data);
}

interface EstadoGravado {
  lead_id: string;
  bucket: RiskBucket;
  detected_at: string;
}

export async function observaTravessias(
  admin: SupabaseClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<ResultadoDaObservacao> {
  const atuais = await calculaBucketsAtuais(admin, organizationId, now);

  let gravados: EstadoGravado[];
  try {
    gravados = await fetchAllPages<EstadoGravado>(
      (from, to) =>
        admin
          .from("crm_lead_risk_states")
          .select("lead_id, bucket, detected_at")
          .eq("organization_id", organizationId)
          .order("lead_id", { ascending: true })
          .range(from, to),
      { resource: "crm_lead_risk_states", logContext: { organizationId } },
    );
  } catch (causa) {
    const message = causa instanceof Error ? causa.message : String(causa);
    throw new Error(`observador de risco: ${message}`);
  }
  const anterior = new Map<string, EstadoGravado>(gravados.map((g) => [g.lead_id, g]));

  const r: ResultadoDaObservacao = {
    avaliados: atuais.length,
    travessias: 0,
    esfriaram: 0,
    reativaram: 0,
    silenciosas: 0,
    falhasDeAtividade: 0,
    propostas: 0,
    esfriamentosJaRegistrados: 0,
  };

  for (const e of atuais) {
    const salvo = anterior.get(e.leadId);
    const de = salvo?.bucket ?? null;
    if (de === e.bucket) {
      // A recusa precisa sobreviver a ticks idênticos, e o prazo longo precisa
      // vencer mesmo sem nova travessia. A proposta compara os fatos e segue
      // idempotente; o estado de risco, este sim, não recebe escrita repetida.
      if (e.bucket === "em_risco" || e.bucket === "critico") {
        const proposta = await propoeReativacao(admin, {
          organizationId,
          leadId: e.leadId,
          coldHours: e.coldHours,
          now,
          requireApprovalConfig: true,
        });
        if (proposta) r.propostas += 1;
      }
      continue;
    }
    const linha = narrar(de, e.bucket);
    // A timeline só desempata quando o estado anterior não veio na leitura.
    // Com estado gravado, a transição manda: em_voo → em_risco é episódio novo
    // mesmo sem atividade da lista positiva (a agenda tira o negócio do crítico
    // e devolve sem "voltar a andar"). A checagem fica ANTES do upsert. Se ela
    // falha, gravar o bucket agora faria o próximo tick achar que nada mudou e
    // a frase — e a proposta que nasce com ela — não seriam tentadas de novo.
    let esfriamentoJaNaTimeline = false;
    if (linha?.tipo === "lead_cooled" && de === null) {
      try {
        esfriamentoJaNaTimeline = await episodioDeEsfriamentoAberto(
          admin,
          organizationId,
          e.leadId,
        );
      } catch (causa) {
        r.falhasDeAtividade += 1;
        logger.error("[risk-worker] não deu para ler o episódio de esfriamento", {
          organizationId,
          leadId: e.leadId,
          error: causa instanceof Error ? causa.message : String(causa),
        });
        continue;
      }
    }
    // Frase já gravada para o estado que ainda está salvo: o upsert da passada
    // anterior falhou. Não insere de novo; só tenta o estado outra vez.
    let fraseJaEntrada = false;
    if (linha && !esfriamentoJaNaTimeline && salvo?.detected_at) {
      try {
        fraseJaEntrada = await atividadeJaEscritaNestaDeteccao(
          admin,
          organizationId,
          e.leadId,
          linha.tipo,
          salvo.detected_at,
        );
      } catch (causa) {
        r.falhasDeAtividade += 1;
        logger.error("[risk-worker] não deu para saber se a frase já entrou", {
          organizationId,
          leadId: e.leadId,
          error: causa instanceof Error ? causa.message : String(causa),
        });
        continue;
      }
    }
    // A frase entra antes do estado. Se a atividade falha, o estado não muda e
    // a próxima passada tenta os dois. Se a atividade entra e o estado falha,
    // a checagem acima acha a frase e não repete.
    if (linha && !esfriamentoJaNaTimeline && !fraseJaEntrada) {
      const atividade = await emitLeadActivity(admin, {
        organizationId,
        leadId: e.leadId,
        contactId: e.contactId,
        type: linha.tipo,
        sourceModule: "crm",
        sourceId: e.leadId,
        // `webhook_source` é como o produto se declara ator: não foi pessoa nem
        // agente, foi o sistema observando o relógio. `actorParaAtividade` o
        // traduz para `actor_kind = 'system'`, que é a FORMA tracejada na
        // timeline — a mesma de qualquer coisa que aconteceu sem alguém decidir.
        actor: { type: "webhook_source", id: "risk-worker" },
        // O reason NOMEIA o estado, nunca dado do negócio — mesma regra do
        // `lead_edited`: reason é renderizado na tela e vai junto em captura,
        // exportação e ticket de suporte.
        reason: linha.reason,
        payload: { de, para: e.bucket, cold_hours: e.coldHours },
      });
      if (!atividade.ok) {
        r.falhasDeAtividade += 1;
        await registraFalhaDeAtividade(admin, {
          organizationId,
          leadId: e.leadId,
          tipo: linha.tipo,
          origem: "lib/leads/risk-worker.observaTravessias",
          erro: atividade.error,
        });
        continue;
      }
    }

    const { error: upErr } = await admin.from("crm_lead_risk_states").upsert(
      {
        lead_id: e.leadId,
        organization_id: organizationId,
        bucket: e.bucket,
        since: e.since.toISOString(),
        // `detected_at` OMITIDO de propósito: o trigger carimba com `now()` do
        // banco e limita `since` ao mesmo instante. O cálculo já impede o limiar
        // futuro quando agenda/presença força o bucket; o trigger fecha também
        // a deriva de segundos entre processo e Postgres.
        cold_hours: e.coldHours,
      },
      { onConflict: "lead_id" },
    );
    if (upErr) {
      // Um dado inconsistente precisa ficar visível com o ID que permite
      // corrigi-lo, mas não pode congelar os outros negócios da organização.
      // A linha segue sem estado gravado e será tentada de novo no próximo tick.
      logger.error("[risk-worker] negócio falhou ao gravar estado", {
        organizationId,
        leadId: e.leadId,
        bucket: e.bucket,
        since: e.since.toISOString(),
        error: upErr.message,
      });
      continue;
    }
    r.travessias += 1;
    // A métrica conta a travessia que ficou gravada. Upsert que falha não
    // incrementa: a passada seguinte é que completa o estado.
    if (linha && !esfriamentoJaNaTimeline) {
      if (linha.tipo === "lead_cooled") r.esfriaram += 1;
      else r.reativaram += 1;
    }

    if (e.bucket === "em_risco" || e.bucket === "critico") {
      // A proposta nasce com o esfriamento, no mesmo tick, e também quando o
      // negócio já estava frio: ela compara os fatos e segue idempotente.
      // Nasce sem rascunho de propósito. Se só existisse com texto de LLM, uma
      // indisponibilidade do provedor viraria silêncio.
      const proposta = await propoeReativacao(admin, {
        organizationId,
        leadId: e.leadId,
        coldHours: e.coldHours,
        now,
        requireApprovalConfig: true,
      });
      if (proposta) r.propostas += 1;
    }

    if (!linha) r.silenciosas += 1;
    else if (esfriamentoJaNaTimeline) r.esfriamentosJaRegistrados += 1;
  }

  return r;
}

export type { EstadoCalculado };
