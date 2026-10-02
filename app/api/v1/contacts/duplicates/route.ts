/**
 * GET /api/v1/contacts/duplicates — quem é a MESMA pessoa cadastrada duas vezes.
 *
 * A detecção é PURA (`lib/contacts/duplicados.ts`) e roda aqui, no servidor,
 * sobre a página de contatos vivos que a RLS deixa o usuário ver. Não é um
 * `select` esperto: os três índices únicos parciais de `contacts` já impedem
 * duas linhas ativas com a MESMA string, então o que sobra para o produto é a
 * grafia diferente do mesmo número (o nono dígito) e o telefone que a ingestão
 * do WhatsApp parkou em `source_metadata.telefone_em_conflito`. Nenhum dos dois
 * é comparação de igualdade, e é por isso que a regra vive em TypeScript
 * testável em vez de virar SQL que ninguém relê.
 *
 * `viewer` pode LISTAR (é leitura de contato, que ele já enxerga na tabela);
 * quem funde é `manager`, e esse gate está na rota de POST /contacts/merge.
 */
import { randomUUID } from "node:crypto";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import {
  encontrarContatosDuplicados,
  principalSugerido,
  type ContatoParaDeduplicar,
} from "@/lib/contacts/duplicados";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Teto de linhas varridas.
 *
 * A varredura é O(n) e roda sobre contatos VIVOS — mas ela é uma tela de
 * limpeza, não um relatório: numa base grande, devolver "os 5.000 grupos" não
 * ajuda ninguém a decidir nada e custa memória do contêiner do self-hoster.
 * Quem passa daqui limpa em levas, e a resposta diz que truncou (`varreu_tudo`)
 * em vez de calar — silêncio aqui leria como "não há mais duplicata".
 */
const TETO_DE_VARREDURA = 2000;

interface FilaDeMesclagem {
  id: string;
  candidates: string[];
  reason: string;
  status: string;
  trigger_payload: Record<string, unknown> | null;
  resolution: Record<string, unknown> | null;
  created_at: string;
}

export async function GET(): Promise<Response> {
  const requestId = randomUUID();

  const user = await loadAuthUser();
  if (!user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }
  const org = await resolveActiveOrg(user);
  if (!org) {
    const t = (texto: string) => traduzir(texto, user.idioma);
    return fail("forbidden_tenant", t("Organização ativa não resolvida."), 403, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contacts")
    .select(
      "id, name, display_name, email, email_normalized, phone_number, is_merged_into, is_anonymized, source_metadata, created_at, last_activity_at",
    )
    .eq("organization_id", org.orgId)
    .is("is_merged_into", null)
    .eq("is_anonymized", false)
    .order("created_at", { ascending: true })
    .limit(TETO_DE_VARREDURA + 1);
  if (error) {
    return fail("internal_error", error.message, 500, { requestId });
  }

  const linhas = (data ?? []) as unknown as ContatoParaDeduplicar[];
  const varreuTudo = linhas.length <= TETO_DE_VARREDURA;
  const gruposDetectados = encontrarContatosDuplicados(linhas.slice(0, TETO_DE_VARREDURA));

  // A fila existente é o destino dos casos em que o mesmo final de telefone
  // não basta para decidir sozinho. Ela também guarda as fusões automáticas
  // recentes, com o snapshot necessário para o botão de desfazer.
  const { data: filas, error: filasError } = await supabase
    .from("merge_queue")
    .select("id, candidates, reason, status, trigger_payload, resolution, created_at")
    .eq("organization_id", org.orgId)
    .in("reason", ["whatsapp_form_provavel", "whatsapp_form_auto_merge"])
    .in("status", ["pending", "resolved"])
    .order("created_at", { ascending: false })
    .limit(100);
  if (filasError) {
    return fail("internal_error", filasError.message, 500, { requestId });
  }

  const filasTipadas = (filas ?? []) as unknown as FilaDeMesclagem[];

  const idsDaFila = [...new Set(filasTipadas.flatMap((f) => f.candidates ?? []))];
  const { data: contatosDaFila, error: contatosDaFilaError } = idsDaFila.length
    ? await supabase
        .from("contacts")
        .select(
          "id, name, display_name, email, email_normalized, phone_number, is_merged_into, is_anonymized, source_metadata, created_at, last_activity_at",
        )
        .eq("organization_id", org.orgId)
        .in("id", idsDaFila)
    : { data: [], error: null };
  if (contatosDaFilaError) {
    return fail("internal_error", contatosDaFilaError.message, 500, { requestId });
  }

  const porId = new Map<string, ContatoParaDeduplicar>();
  for (const contato of [
    ...linhas,
    ...((contatosDaFila ?? []) as unknown as ContatoParaDeduplicar[]),
  ]) {
    porId.set(contato.id, contato);
  }

  const gruposDaFila = filasTipadas
    .filter((fila) => fila.reason === "whatsapp_form_provavel" && fila.status === "pending")
    .map((fila) => {
      const contatos = (fila.candidates ?? [])
        .map((id) => porId.get(id))
        .filter((c): c is ContatoParaDeduplicar =>
          Boolean(c && !c.is_merged_into && !c.is_anonymized),
        );
      const principal = String(
        (fila.trigger_payload as Record<string, unknown> | null)?.whatsapp_contact_id ?? "",
      );
      return {
        chave: `fila:${fila.id}`,
        queue_id: fila.id,
        motivos: ["telefone_final_whatsapp" as const],
        principal_sugerido: contatos.some((c) => c.id === principal)
          ? principal
          : (contatos[0]?.id ?? ""),
        contatos,
      };
    })
    .filter((grupo) => grupo.contatos.length >= 2);

  const chavesDaFila = new Set(
    gruposDaFila.map((g) =>
      g.contatos
        .map((c) => c.id)
        .sort()
        .join(":"),
    ),
  );
  const grupos = [
    ...gruposDaFila,
    ...gruposDetectados
      .filter(
        (g) =>
          !chavesDaFila.has(
            g.contatos
              .map((c) => c.id)
              .sort()
              .join(":"),
          ),
      )
      .map((grupo) => ({ ...grupo, principal_sugerido: principalSugerido(grupo) })),
  ];

  const mesclagensAutomaticas = filasTipadas
    .filter((fila) => fila.reason === "whatsapp_form_auto_merge" && fila.status === "resolved")
    .map((fila) => {
      const gatilho = (fila.trigger_payload ?? {}) as Record<string, unknown>;
      const whatsappId = String(gatilho.whatsapp_contact_id ?? "");
      const formularioId = String(gatilho.form_contact_id ?? "");
      const whatsapp = porId.get(whatsappId);
      const formulario = porId.get(formularioId);
      return {
        id: fila.id,
        whatsapp_contact_id: whatsappId,
        form_contact_id: formularioId,
        whatsapp_name: whatsapp?.display_name ?? whatsapp?.name ?? null,
        form_name: formulario?.name ?? formulario?.display_name ?? null,
        whatsapp_phone: whatsapp?.phone_number ?? null,
        original_form_phone:
          typeof gatilho.telefone_original_formulario === "string"
            ? gatilho.telefone_original_formulario
            : null,
        merged_at: fila.created_at,
      };
    });

  return ok(
    grupos.map((grupo) => ({
      chave: grupo.chave,
      motivos: grupo.motivos,
      queue_id: "queue_id" in grupo ? grupo.queue_id : undefined,
      principal_sugerido: grupo.principal_sugerido,
      contatos: grupo.contatos.map((c) => ({
        id: c.id,
        name: c.name,
        display_name: c.display_name,
        email: c.email,
        phone_number: c.phone_number,
        created_at: c.created_at,
        last_activity_at: c.last_activity_at,
      })),
    })),
    {
      requestId,
      meta: {
        varreu_tudo: varreuTudo,
        contatos_varridos: Math.min(linhas.length, TETO_DE_VARREDURA),
        mesclagens_automaticas: mesclagensAutomaticas,
      },
    },
  );
}
