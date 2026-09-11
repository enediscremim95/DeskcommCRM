/**
 * channel-health — o vigia que PERGUNTA se a conexão está de pé.
 *
 * ─── Por que perguntar, se o webhook já conta ──────────────────────────────
 *
 * Porque o webhook emudece exatamente quando mais falta. Ele avisa em segundos
 * enquanto o transporte está vivo; quando o transporte morre, o container cai ou
 * a assinatura do webhook se perde, não chega evento nenhum — e "nenhum evento"
 * é indistinguível de "tudo bem". A coluna segue dizendo `WORKING` para sempre.
 *
 * Foi assim que uma desconexão real passou horas despercebida numa instalação de
 * verdade: nada quebrou, nada alertou, e o dono só descobriu ao estranhar que
 * ninguém escrevia e ir olhar por conta própria.
 *
 * Este cron fecha esse buraco pelo único jeito que existe: fazendo a pergunta.
 * Silêncio deixa de ser resposta.
 *
 * ─── O que ele NÃO faz ─────────────────────────────────────────────────────
 *
 * Não reinicia sessão. Religar sozinho uma conexão que caiu por bloqueio da
 * plataforma é a receita para transformar uma suspensão temporária em definitiva
 * — e reconectar exige, com frequência, um humano com o celular na mão. O vigia
 * informa; a decisão é de quem lê.
 *
 * ─── E o watchdog do worker, que RELIGA? ───────────────────────────────────
 *
 * `lib/agent-engine/edge/crm/session-reconciler.ts` religa — e as duas regras
 * não se contradizem porque falam de estados diferentes. Ele retoma APENAS
 * `STOPPED`, que é a sessão que o transporte não iniciou (contêiner reiniciado,
 * com a credencial intacta no volume), e NUNCA `FAILED` nem `SCAN_QR_CODE`, que
 * são justamente os estados de sessão derrubada pela plataforma ou deslogada. É
 * sobre esses dois que o parágrafo acima fala, e sobre eles nada religa sozinho.
 *
 * Se alguém for afrouxar aquele filtro, é este parágrafo que precisa cair
 * primeiro — e a razão dele continua de pé.
 *
 * Auth: Bearer INTERNAL_CRON_SECRET|INTERNAL_SECRET (fail-closed), como os demais.
 *
 * NOTA DE DEPLOY: o agendamento vive no serviço `scheduler` do
 * `docker-compose.prod.yml` — não há `vercel.json` neste repo (self-host).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import {
  CHANNEL_SESSION_REF_COLUMNS,
  DEFAULT_CHANNEL_PROVIDER,
  getAdapter,
  resolveSessionRef,
  canalConhecidoSemMensagem,
  type ChannelProvider,
  type ChannelSessionRef,
} from "@/lib/channels";
import { sincronizarSaudeDaConexao } from "@/lib/channels/health";
import { diagnosticarSilencioInbound } from "@/lib/channels/inbound-silence";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Teto por rodada. Cada sessão é uma chamada de rede ao transporte. */
const LIMITE = 50;
// ⚠️ O texto NÃO nomeia o provider, e não é preferência de estilo: o
// `lint:channels` (doutrina restrição-de-canal, invariante 1) reprova o nome em
// qualquer posição do arquivo, string de aviso inclusive. E o aviso fica melhor
// assim — quem atende não precisa saber qual transporte está por baixo, precisa
// saber que o número parou de receber.
const CORPO_DO_SILENCIO =
  "O canal continua conectado, mas parou de registrar mensagens além do padrão recente deste número. " +
  "Confira a conexão do WhatsApp e reconecte somente se a investigação confirmar que a entrada travou.";

async function vigiarSilencioInbound(
  admin: ReturnType<typeof createAdminClient>,
  sessao: Pick<LinhaDeSessao, "id" | "organization_id" | "status" | "display_name" | "phone_number">,
): Promise<"silencio_avisado" | "silencio_resolvido" | "silencio_normal" | "silencio_sem_amostra"> {
  // Status saudável é pré-condição. Se o canal se declarou fora do ar, o aviso
  // de estado é mais honesto e já existe; não abrimos dois alarmes para a mesma ação.
  if (sessao.status !== "WORKING") return "silencio_normal";
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const { data } = await admin
    .from("messages")
    .select("sent_at")
    .eq("organization_id", sessao.organization_id)
    .eq("channel_session_id", sessao.id)
    .eq("direction", "inbound")
    .gte("sent_at", desde)
    .order("sent_at", { ascending: false })
    .limit(100);
  const diagnostico = diagnosticarSilencioInbound((data ?? []).map((m) => m.sent_at as string));
  if (diagnostico.limiarMs === null) return "silencio_sem_amostra";

  const abertos = await admin
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", sessao.organization_id)
    .eq("kind", "channel_number_alert")
    .eq("ref_kind", "channel_session")
    .eq("ref_id", sessao.id)
    .eq("body", CORPO_DO_SILENCIO)
    .eq("status", "open");
  const jaAberto = (abertos.data ?? []).length > 0;
  if (!diagnostico.deveAvisar) {
    if (!jaAberto) return "silencio_normal";
    await admin.from("agent_inbox_items").update({ status: "resolved" })
      .eq("organization_id", sessao.organization_id).eq("kind", "channel_number_alert")
      .eq("ref_kind", "channel_session").eq("ref_id", sessao.id)
      .eq("body", CORPO_DO_SILENCIO).eq("status", "open");
    return "silencio_resolvido";
  }
  if (jaAberto) return "silencio_normal";
  const apelido = sessao.display_name ?? sessao.phone_number ?? "sem nome";
  const minutos = Math.round(diagnostico.limiarMs / 60_000);
  await admin.from("agent_inbox_items").insert({
    organization_id: sessao.organization_id,
    kind: "channel_number_alert",
    severity: "critical",
    title: `WhatsApp "${apelido}" parece ligado, mas não está recebendo mensagens`,
    body: CORPO_DO_SILENCIO,
    ref_kind: "channel_session",
    ref_id: sessao.id,
    metadata: { origem: "inbound_silence_watchdog", amostra: diagnostico.amostra, limiar_minutos: minutos },
  });
  return "silencio_avisado";
}

type LinhaDeSessao = ChannelSessionRef & {
  id: string;
  organization_id: string;
  status: string | null;
  display_name: string | null;
  phone_number: string | null;
  archived_at: string | null;
};

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted = [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const admin = createAdminClient();

  // Arquivada não é vigiada: ela foi desligada de propósito, e avisar que uma
  // conexão aposentada está parada é exatamente o ruído que faz o operador
  // ignorar a Central.
  const { data, error } = await admin
    .from("channel_sessions")
    .select(
      `id, organization_id, status, display_name, phone_number, archived_at, ${CHANNEL_SESSION_REF_COLUMNS}`,
    )
    .is("archived_at", null)
    .limit(LIMITE);

  if (error) {
    logger.error("[channel-health] query falhou", { detail: error.message, requestId });
    return fail("internal_error", error.message, 500, { requestId });
  }

  const sessoes = (data ?? []) as LinhaDeSessao[];
  let verificadas = 0;
  const desfechos: Record<string, number> = {};
  let ignoradas = 0;

  for (const s of sessoes) {
    // Canal CONHECIDO que não transporta mensagem não tem saúde de mensagem a
    // vigiar — e a linha de chamada de voz (spec 18) é uma dessas. Este
    // `continue` vem ANTES de `getAdapter` de propósito: é decisão de escopo,
    // não erro, e um `warn` por sessão de voz a cada minuto seria ruído
    // perpétuo. É `canalConhecidoSemMensagem` e não `!transportaMensagem`
    // justamente para que um provider DESCONHECIDO não caia aqui em silêncio:
    // ele segue para o `getAdapter` abaixo, que lança, e o `catch` da iteração
    // deixa o rastro.
    if (canalConhecidoSemMensagem(s.provider)) {
      ignoradas++;
      continue;
    }

    try {
      // Pergunta ao CANAL, não ao provider: quem tem sessão para consultar
      // implementa `checkHealth`; quem não tem simplesmente não o expõe, e o
      // vigia segue adiante sem nunca perguntar QUEM ele é — o invariante 1 da
      // doutrina.
      //
      // DENTRO do try, e a diferença é a rodada inteira: `getAdapter` falha
      // FECHADO (`unknown_channel_provider`), e o `catch` desta iteração fica
      // logo abaixo. Enquanto a chamada morava fora, um provider que o banco já
      // aceita e esta imagem ainda não conhece — o clone que aplicou o baseline
      // antes de puxar a imagem nova — abortava `handle()` no meio do laço:
      // TODOS os tenants seguintes daquela rodada ficavam sem vigia, e o
      // operador via 500 no cron sem nenhuma pista de qual linha o derrubou.
      const adapter = getAdapter((s.provider ?? DEFAULT_CHANNEL_PROVIDER) as ChannelProvider);
      const sessionRef = resolveSessionRef(s);
      if (!adapter.checkHealth || !sessionRef) continue;

      const saude = await adapter.checkHealth({
        organizationId: s.organization_id,
        sessionRef,
      });
      verificadas++;

      // O status novo vale para o banco, mas SÓ quando deu para perguntar:
      // gravar por cima com um erro de rede transitório trocaria informação boa
      // por ruído, e é o mesmo cuidado que a tela de conexões já toma.
      let statusFinal = s.status;
      if (saude.reachable && saude.status && saude.status !== s.status) {
        statusFinal = saude.status;
        const agora = new Date().toISOString();
        await admin
          .from("channel_sessions")
          .update({ status: saude.status, last_status_change_at: agora })
          .eq("id", s.id)
          .eq("organization_id", s.organization_id);
      }

      const apelido = s.display_name ?? s.phone_number ?? "sem nome";
      const desfecho = await sincronizarSaudeDaConexao(
        admin,
        { id: s.id, organization_id: s.organization_id, status: statusFinal },
        saude,
        apelido,
      );
      desfechos[desfecho] = (desfechos[desfecho] ?? 0) + 1;
      const silencio = await vigiarSilencioInbound(admin, { ...s, status: statusFinal });
      desfechos[silencio] = (desfechos[silencio] ?? 0) + 1;
    } catch (err) {
      // Uma sessão problemática não derruba o lote — as outras ainda precisam
      // ser vigiadas, e é justamente numa rodada assim que alguma pode ter caído.
      logger.warn("[channel-health] falhou numa sessão", {
        sessionId: s.id,
        detail: err instanceof Error ? err.message : "erro",
        requestId,
      });
    }
  }

  return ok({ sessoes: sessoes.length, verificadas, ignoradas, ...desfechos }, { requestId });
}

export const GET = handle;
export const POST = handle;
