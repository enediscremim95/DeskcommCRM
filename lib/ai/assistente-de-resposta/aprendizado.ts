import type pg from "pg";
import type { ServiceBoundary } from "@/lib/atendimento/fronteira";

interface ExemploDeResposta {
  original_body: string | null;
  approved_body: string | null;
  feedback: unknown;
}

export async function carregarAprendizadoDaOrganizacao(
  pool: pg.Pool,
  input: {
    organizationId: string;
    conversationId: string;
    channelId: string;
    boundary: ServiceBoundary;
  },
): Promise<string> {
  const [{ rows: feedback }, { rows: examples }] = await Promise.all([
    pool.query<{ feedback: unknown }>(
      `select feedback from ai_reply_drafts
       where organization_id=$1 and conversation_id=$2 and service_boundary=$3
         and feedback is not null
       order by updated_at desc limit 3`,
      [input.organizationId, input.conversationId, input.boundary],
    ),
    pool.query<ExemploDeResposta>(
      `select left(original_body,2000) as original_body,
              left(approved_body,2000) as approved_body,
              feedback
       from ai_reply_drafts
       where organization_id=$1 and channel_session_id=$2
         and status in ('approved','sending','sent')
         and approved_body is not null
         and feedback->>'decision' in ('approved','edited')
       order by updated_at desc limit 3`,
      [input.organizationId, input.channelId],
    ),
  ]);
  return JSON.stringify({
    feedback_da_conversa: feedback.map((row) => row.feedback),
    exemplos_recentes_do_mesmo_canal: examples.map((row) => ({
      sugestao: row.original_body,
      resposta_final: row.approved_body,
      decisao: row.feedback,
    })),
  });
}

