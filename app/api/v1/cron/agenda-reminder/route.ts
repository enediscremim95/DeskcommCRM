/**
 * O LEMBRETE DO COMPROMISSO — o consumidor que faltava.
 *
 * A migration 0177 declarou que `calendar_appointments.contact_id` é "quem
 * recebe o LEMBRETE", `calendar_event_types` ganhou `reminder_enabled` e
 * `reminder_minutes_before`, a tela oferece os dois — e nada nunca leu
 * `reminder_sent_at`. O comentário de `app/api/v1/agenda/agendamentos/_handler.ts`
 * fala desta rota no futuro do pretérito: "no dia em que o worker de lembrete
 * nascer". Este é o dia.
 *
 * Enquanto ele não existia, ligar o lembrete no tipo de agendamento não fazia
 * nada — e não fazia nada EM SILÊNCIO, que é o caro: quem configurou acreditou
 * que o paciente seria avisado. Coluna sem consumidor é o anti-pattern nº 3 do
 * CLAUDE.md deste repo, e este era um deles.
 *
 * ═══ O QUE ESTA ROTA DECIDE, E POR QUÊ ═══
 *
 * **Lembrete é transacional, não marketing.** Quem recusou receber campanha
 * continua recebendo aviso do próprio compromisso. `consent.marketing.declined_at`
 * NÃO barra: esconder de alguém que o pedido dele está pronto não é respeitar a
 * recusa, é perder a entrega. Bloqueio de contato (`is_blocked`) e ausência de
 * telefone barram, porque aí não há para onde mandar.
 *
 * **A janela de envio vale.** Um lembrete que chega às 6h da manhã é o tipo de
 * mensagem que faz o número ser denunciado. Fora da janela do canal a rodada
 * simplesmente não marca `reminder_sent_at`, e a próxima tenta de novo — o
 * adiamento é o silêncio, não uma fila nova.
 *
 * **O carimbo é da TENTATIVA, não da entrega.** `sendMessageHandler` marca
 * `failed`/`queued` na própria mensagem e devolve normalmente; o estado da
 * entrega vive lá. Se este carimbo esperasse a entrega, um contato com número
 * permanentemente inválido receberia uma tentativa a cada 5 minutos até a hora
 * do compromisso.
 *
 * **Compromisso que já começou não gera lembrete.** Avisar às 15h de uma
 * retirada das 14h não é lembrete, é ruído — e o carimbo some com a linha da
 * varredura seguinte de qualquer jeito.
 *
 * ⚠️ **O contato é resolvido DENTRO da organização do compromisso.** É a
 * preocupação literal do handler de agendamentos: "esta linha vira a organização
 * A mandando WhatsApp para o cliente da B". Aqui `organization_id` sai sempre da
 * linha do compromisso e filtra a busca do contato, da conversa e do canal —
 * nunca de parâmetro. O `route.test.ts` ao lado prende isso.
 *
 * ⚠️ **ESTA ROTA NASCE DORMENTE, E ISSO É DE PROPÓSITO.** A migration 0194
 * (`lembrete_nasce_desligado`) pôs `calendar_event_types.reminder_enabled` em
 * `default false` e zerou o histórico, justamente porque não havia disparador —
 * e escreveu por extenso que "ligar lembrete por padrão fica com o dono do
 * produto NO DIA em que o disparador nascer". Este é o disparador; a decisão
 * segue sendo dele, e nada aqui a toma por ele.
 *
 * Medido na main 58dcb811: `reminder_enabled` não aparece no `criarSchema` nem
 * no `alterarSchema` de `app/api/v1/agenda/tipos/route.ts`, não é projetado no
 * GET dessa rota, e não existe em `app/app/settings/tenant/agenda/`. Ou seja:
 * hoje ninguém consegue LIGAR o lembrete pela tela nem pela API. Enquanto isso
 * for verdade, a consulta abaixo devolve zero linhas em toda instalação — a
 * varredura é barata e o envio é nenhum. A superfície de configuração é o outro
 * meio do par, e falta escrevê-la (invariante 6 do Sistema Vivo).
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { sendMessageHandler } from "@/app/api/v1/messages/_handler";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { ensureConversation } from "@/lib/automation/start-conversation";
import { adiarAteAJanelaAbrir } from "@/lib/automation/janela-do-canal";
import { espacarEnvio } from "@/lib/automation/throttle";
import { env } from "@/lib/env";
import {
  aplicarVariaveisDoLembrete,
  dataEHoraDoLembrete,
  idDaMensagemDoLembrete,
  linkDaSala,
  linkParaOModelo,
} from "@/lib/agenda/lembrete";
import { escalonarLembretesSemResposta } from "@/lib/agenda/escalonamento-do-lembrete";
import { traduzir } from "@/lib/i18n/dicionario";
import { IDIOMA_PADRAO, normalizarIdioma, type Idioma } from "@/lib/i18n/idiomas";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto de compromissos examinados por rodada — a varredura roda a cada 5 min. */
const LIMITE_DA_VARREDURA = 200;

/**
 * Validade da posse do ENVIO do lembrete. Menor que o intervalo do cron (5 min):
 * uma rodada que morreu com a posse não atrasa a reentrega além da rodada seguinte
 * — a mesma garantia da main, onde nada impedia o reenvio.
 */
const LEASE_DO_ENVIO_MS = 4 * 60_000;

/** Maior antecedência aceita pela coluna (43200 min = 30 dias). */
const MAIOR_ANTECEDENCIA_MS = 43_200 * 60_000;

interface TipoDoCompromisso {
  /** A organização DO TIPO — `event_type_id` tem FK só por `id`; o tipo tem de ser da org do compromisso. */
  organization_id?: string;
  /** Opt-in (migration 0320): link da sala + variáveis no modelo. Ausente/false = texto de antes. */
  reminder_rich_format?: boolean;
  name: string;
  reminder_enabled: boolean;
  reminder_minutes_before: number;
  reminder_template_name: string | null;
  location_details: string | null;
}

interface CompromissoAVencer {
  id: string;
  organization_id: string;
  contact_id: string;
  title: string;
  starts_at: string;
  location_details: string | null;
  meeting_state?: string | null;
  meeting_url?: string | null;
  calendar_event_types: TipoDoCompromisso | TipoDoCompromisso[] | null;
}

/** O join do PostgREST devolve objeto ou array conforme a cardinalidade inferida. */
function tipoDe(linha: CompromissoAVencer): TipoDoCompromisso | null {
  const t = linha.calendar_event_types;
  if (!t) return null;
  return Array.isArray(t) ? (t[0] ?? null) : t;
}

/**
 * O texto do lembrete.
 *
 * `reminder_template_name` é a outra coluna que a 0177 criou e ninguém leu.
 * Quando ela aponta para um modelo de mensagem da organização, ele vence; sem
 * ela, sai o texto abaixo, que diz as três coisas que a pessoa precisa saber:
 * o que é, quando, e onde.
 */
export function montarLembrete(input: {
  nomeDoContato: string | null;
  titulo: string;
  quando: Date;
  timezone: string;
  local: string | null;
  /**
   * O idioma da ORGANIZAÇÃO (`organizations.locale`), e não um literal.
   *
   * `tests/unit/i18n-a-data-segue-o-idioma.test.ts` proíbe `"pt-BR"` escrito à
   * mão em formatação de data fora de `lib/i18n/datas.ts` — e o motivo não é
   * estética: uma instalação em espanhol receberia o lembrete com "jueves, 03/09"
   * no meio de uma frase em português, que é a tela meio traduzida que aquele
   * guarda existe para impedir. Aqui vale em dobro, porque isto não é tela: é
   * mensagem que sai para o WhatsApp de um cliente e não dá para desfazer.
   *
   * Opcional com o padrão do produto para a função seguir pura e testável sem
   * banco — o mesmo desenho de `montarPares` em `lib/metrics/atrito.ts`.
   */
  idioma?: Idioma;
  /**
   * Link da SALA pronta (Meet/Jitsi). Ausente = texto de antes, palavra por
   * palavra. Igual ao endereço já impresso = não repete. Ver `lib/agenda/lembrete.ts`.
   */
  link?: string | null;
}): string {
  const idioma = input.idioma ?? IDIOMA_PADRAO;
  const t = (texto: string) => traduzir(texto, idioma);
  const { data: dia, hora } = dataEHoraDoLembrete(input.quando, input.timezone, idioma);

  // Cada `t()` cobre só a parte FIXA da frase: nome, título, data e endereço
  // são dado do tenant e nunca passam por tradução.
  // A pontuação entra na CHAVE de propósito: em espanhol a exclamação abre a
  // frase ("¡Hola"), e um `t("Oi")` solto com o `!` colado do lado de fora
  // devolveria "Hola, Rose!" — meio traduzido, que é o defeito que o guarda de
  // i18n existe para impedir.
  const saudacao = input.nomeDoContato
    ? `${t("Oi,")} ${input.nomeDoContato}!`
    : t("Oi!");
  const onde = input.local ? ` ${t("Endereço")}: ${input.local}.` : "";
  const link = input.link?.trim();
  const sala = link && link !== input.local?.trim() ? ` ${t("Link da reunião")}: ${link}` : "";
  return (
    `${saudacao} ${t("Passando pra lembrar do seu compromisso:")} ` +
    `${input.titulo}, ${dia} ${t("às")} ${hora}.${onde}${sala}`
  );
}

/**
 * Está na hora de lembrar?
 *
 * Pura, e exportada, porque é a regra que o teste precisa exercitar sem banco:
 * cedo demais não manda, tarde demais (já começou) também não.
 */
export function estaNaHora(agora: Date, comeca: Date, antecedenciaMin: number): boolean {
  if (comeca.getTime() <= agora.getTime()) return false;
  return comeca.getTime() - antecedenciaMin * 60_000 <= agora.getTime();
}

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const fornecido = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const aceitos = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (aceitos.length === 0 || !fornecido || !aceitos.includes(fornecido)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();
  const agora = new Date();

  // `!inner` no tipo: só interessa compromisso cujo TIPO pede lembrete. O corte
  // por `starts_at` usa a maior antecedência possível — o corte fino, que depende
  // do `reminder_minutes_before` de cada linha, é `estaNaHora` logo abaixo.
  const { data, error } = await admin
    .from("calendar_appointments")
    .select(
      "id, organization_id, contact_id, title, starts_at, location_details, meeting_state, meeting_url, " +
        "calendar_event_types!inner(organization_id, name, reminder_enabled, reminder_minutes_before, reminder_template_name, location_details, reminder_rich_format)",
    )
    .eq("status", "confirmed")
    .eq("calendar_event_types.reminder_enabled", true)
    .not("contact_id", "is", null)
    .is("reminder_sent_at", null)
    .gt("starts_at", agora.toISOString())
    .lte("starts_at", new Date(agora.getTime() + MAIOR_ANTECEDENCIA_MS).toISOString())
    .order("starts_at", { ascending: true })
    .limit(LIMITE_DA_VARREDURA);

  if (error) {
    logger.error("[agenda-reminder] consulta falhou", { error: error.message, requestId });
    return fail("internal_error", "Falha ao buscar compromissos.", 500, { requestId });
  }

  const linhas = (data ?? []) as unknown as CompromissoAVencer[];
  let enviados = 0;
  let pulados = 0;
  const motivos: Record<string, number> = {};
  const pular = (motivo: string) => {
    pulados += 1;
    motivos[motivo] = (motivos[motivo] ?? 0) + 1;
  };

  for (const linha of linhas) {
    const tipo = tipoDe(linha);
    if (!tipo) {
      pular("sem_tipo");
      continue;
    }
    if (!estaNaHora(agora, new Date(linha.starts_at), tipo.reminder_minutes_before)) {
      pular("ainda_nao");
      continue;
    }

    // ⚠️ organization_id SEMPRE da linha do compromisso — ver o cabeçalho.
    const org = linha.organization_id;

    // O TIPO tem de ser da MESMA organização: a FK de `event_type_id` é só por
    // `id`, e um vínculo cruzado (escrito por service role) emprestaria o
    // opt-in, a antecedência, o modelo e o local de outro tenant.
    if (tipo.organization_id !== org) {
      pular("tipo_de_outra_org");
      continue;
    }

    const { data: contato } = await admin
      .from("contacts")
      .select("id, name, display_name, phone_number, is_blocked")
      .eq("id", linha.contact_id)
      .eq("organization_id", org)
      .maybeSingle();

    if (!contato) {
      pular("contato_fora_da_org");
      continue;
    }
    if (contato.is_blocked) {
      pular("contato_bloqueado");
      continue;
    }
    if (!contato.phone_number) {
      pular("sem_telefone");
      continue;
    }

    const { data: canal } = await admin
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", org)
      .eq("status", "WORKING")
      .limit(1)
      .maybeSingle();

    if (!canal) {
      pular("sem_canal");
      continue;
    }

    const foraDaJanela = await adiarAteAJanelaAbrir(admin, org, canal.id);
    if (foraDaJanela) {
      pular("fora_da_janela");
      continue;
    }

    const { data: organizacao } = await admin
      .from("organizations")
      .select("timezone, locale")
      .eq("id", org)
      .maybeSingle();

    const nomeDoContato = contato.display_name ?? contato.name ?? null;
    const fuso = organizacao?.timezone ?? "America/Sao_Paulo";
    const idioma = normalizarIdioma(organizacao?.locale);
    // OPT-IN por tipo (migration 0320). Desligado = o lembrete de antes, byte a
    // byte: sem a linha do link e com o modelo enviado sem interpolação.
    const formatoRico = tipo.reminder_rich_format === true;
    let corpo = montarLembrete({
      nomeDoContato,
      titulo: linha.title,
      quando: new Date(linha.starts_at),
      timezone: fuso,
      local: linha.location_details ?? tipo.location_details ?? null,
      idioma,
      link: formatoRico ? linkDaSala(linha) : null,
    });

    if (tipo.reminder_template_name) {
      const { data: modelo } = await admin
        .from("message_templates")
        .select("body")
        .eq("organization_id", org)
        .or(`shortcut.eq.${tipo.reminder_template_name},title.eq.${tipo.reminder_template_name}`)
        .limit(1)
        .maybeSingle();
      if (modelo?.body && !formatoRico) {
        corpo = modelo.body;
      } else if (modelo?.body) {
        // Variáveis {{nome}} {{data}} {{hora}} {{link}} — modelo sem elas sai igual.
        corpo = aplicarVariaveisDoLembrete(modelo.body, {
          nome: nomeDoContato ?? "",
          ...dataEHoraDoLembrete(new Date(linha.starts_at), fuso, idioma),
          link: linkParaOModelo({
            meeting_state: linha.meeting_state,
            meeting_url: linha.meeting_url,
            location_details: linha.location_details,
            tipo_location_details: tipo.location_details,
          }),
        });
      }
    }

    // POSSE DO ENVIO (lease) — e NÃO o carimbo. Na main o carimbo vinha depois
    // do envio: queda no meio = a rodada seguinte manda de novo. Isso continua
    // valendo: `reminder_sent_at` só é gravado DEPOIS do envio (abaixo). O que a
    // posse acrescenta é que duas rodadas cruzadas não enviam ao mesmo tempo; e
    // ela EXPIRA em `LEASE_DO_ENVIO_MS` (menor que o intervalo do cron), então
    // uma rodada que morreu com a posse não tira o compromisso da fila.
    const posse = new Date().toISOString();
    const { error: libErr } = await admin
      .from("calendar_appointments")
      .update({ reminder_claimed_at: null })
      .eq("id", linha.id)
      .eq("organization_id", org)
      .is("reminder_sent_at", null)
      .lt("reminder_claimed_at", new Date(Date.now() - LEASE_DO_ENVIO_MS).toISOString());
    const { data: tomou, error: posseErr } = libErr
      ? { data: null, error: libErr }
      : await admin
          .from("calendar_appointments")
          .update({ reminder_claimed_at: posse })
          .eq("id", linha.id)
          .eq("organization_id", org)
          .is("reminder_sent_at", null)
          .is("reminder_claimed_at", null)
          .select("id");
    if (posseErr || !tomou?.length) {
      pular("ja_em_envio");
      continue;
    }

    await espacarEnvio(canal.id);

    let enviada: { id?: string } | null = null;
    let conversaId: string;
    try {
      conversaId = await ensureConversation(admin, org, contato.id, canal.id);
      // `webhook_source` é o ator que esta base dá a envio nascido de worker —
      // o mesmo que `lib/followup/enviar-texto-fixo.ts` usa. O `id` é o
      // compromisso, para o audit da mensagem correlacionar com a linha que a
      // originou. O id da MENSAGEM é determinístico pelo compromisso: a
      // reentrega depois de uma queda reencontra a linha em vez de mandar de novo.
      enviada = (await sendMessageHandler(
        admin,
        {
          organization_id: org,
          actor: { type: "webhook_source", id: linha.id },
          requestId: `agenda-reminder:${linha.id}`,
          internalMessageId: idDaMensagemDoLembrete(linha.id),
          deduplicateInternalMessage: true,
        },
        { conversation_id: conversaId, type: "text", body: corpo } as Parameters<
          typeof sendMessageHandler
        >[2],
      )) as { id?: string } | null;
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      logger.error("[agenda-reminder] envio falhou", { appointmentId: linha.id, error: mensagem, requestId });
      // Exceção = o envio não aconteceu: devolve a posse para a próxima rodada.
      await admin
        .from("calendar_appointments")
        .update({ reminder_claimed_at: null })
        .eq("id", linha.id)
        .eq("organization_id", org)
        .eq("reminder_claimed_at", posse);
      pular("erro_no_envio");
      continue;
    }

    // Carimba a TENTATIVA — o desfecho da entrega vive na mensagem. É o MESMO
    // carimbo da main, gravado no MESMO ponto (depois do envio), e leva junto o
    // que o escalonamento precisa: qual mensagem saiu e em que conversa. Um
    // update só: o escalonamento nunca vê `reminder_sent_at` sem as referências.
    // Se este update falhar, a posse expira e a rodada seguinte reencontra a
    // mensagem pelo id determinístico (sem reenviar) e carimba.
    const { error: carimboErr } = await admin
      .from("calendar_appointments")
      .update({
        reminder_sent_at: new Date().toISOString(),
        reminder_message_id: enviada?.id ?? null,
        reminder_conversation_id: conversaId,
        reminder_claimed_at: null,
      })
      .eq("id", linha.id)
      .eq("organization_id", org)
      .eq("reminder_claimed_at", posse);
    if (carimboErr) {
      logger.warn("[agenda-reminder] carimbo do envio não gravado; a próxima rodada reencontra a mensagem", {
        appointmentId: linha.id,
        error: carimboErr.message,
      });
      pular("carimbo_pendente");
      continue;
    }
    enviados += 1;
  }

  // Rodada que não avisou ninguém NÃO é mutação, e não audita — a lei está no
  // CLAUDE.md §Audit log, e `tests/unit/cron-audita-so-quando-ha-efeito.test.ts`
  // varre o AST de toda rota deste diretório atrás de `audit` incondicional.
  if (enviados > 0) {
    await audit({
      action: "agenda.lembrete_enviado",
      resourceType: "calendar_appointment",
      requestId,
      metadata: { enviados, pulados, motivos },
    });
  }

  // ESCALONAMENTO PÓS-LEMBRETE (migration 0320, opt-in por tipo). Mesma rodada,
  // nenhum worker novo: só olha compromisso cujo tipo LIGOU o escalonamento.
  const escalonamento = await escalonarLembretesSemResposta(admin, agora);
  const decididos = escalonamento.escalados + escalonamento.confirmados + escalonamento.nao_aplicaveis;
  if (decididos > 0) {
    await audit({
      action: "agenda.lembrete_escalonamento",
      resourceType: "calendar_appointment",
      requestId,
      metadata: {
        escalados: escalonamento.escalados,
        confirmados: escalonamento.confirmados,
        nao_aplicaveis: escalonamento.nao_aplicaveis,
      },
    });
  }

  return ok({ examinados: linhas.length, enviados, pulados, motivos, escalonamento }, { requestId });
}

export const GET = handle;
export const POST = handle;
