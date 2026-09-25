"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { generateText } from "ai";

import { audit } from "@/lib/audit";
import { loadCredential } from "@/lib/ai/credentials";
import { buildModel, chaveDePlataforma } from "@/lib/ai/runtime/agent";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import type { TravaId } from "@/lib/ai/atendimento/flow";
import { saveAgentDraftAction } from "../agents/[id]/_actions";

const TRAVAS_AUDITAVEIS = new Set<TravaId>([
  "horario",
  "ritmo_humano",
  "uma_conversa",
  "teto_diario",
]);

/**
 * Salva pela mesma ação do editor fino e acrescenta a trilha explícita quando
 * uma proteção configurável foi desligada nesta edição.
 */
export async function saveAtendimentoDraftAction(
  agentId: string,
  payload: unknown,
  cadastro: unknown,
  disabledNow: TravaId[],
) {
  const result = await saveAgentDraftAction(agentId, payload, cadastro);
  if (!result.ok || disabledNow.length === 0) return result;

  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false as const, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return { ok: false as const, error: "forbidden_role" };
  }
  const guardrails = [...new Set(disabledNow)].filter((id) => TRAVAS_AUDITAVEIS.has(id));
  if (guardrails.length > 0) {
    await audit({
      action: "ai_agent.guardrails_disabled",
      actorUserId: authUser.id,
      organizationId: activeOrg.orgId,
      resourceType: "ai_agent_version",
      resourceId: result.data!.version_id,
      requestId: randomUUID(),
      metadata: { agent_id: agentId, guardrails },
    });
  }
  revalidatePath("/app/ai/atendimento");
  return result;
}

/**
 * A conversa da tela só propõe texto para o mesmo rascunho versionado. Nenhum
 * efeito externo ocorre aqui e publicar continua sendo um segundo ato humano.
 */
export async function proposeAttendanceInstructionAction(
  currentPrompt: string,
  instruction: string,
  provider: string,
  model: string,
  credentialId: string | null,
): Promise<{ ok: true; prompt: string; summary: string[] } | { ok: false; error: string }> {
  const authUser = await loadAuthUser();
  if (!authUser) return { ok: false, error: "unauthenticated" };
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg || ROLE_RANK[activeOrg.role] < ROLE_RANK.manager) {
    return { ok: false, error: "forbidden_role" };
  }
  const pedido = instruction.trim();
  if (pedido.length < 10 || pedido.length > 2_000) return { ok: false, error: "invalid_request" };
  const base = currentPrompt.trim().slice(0, 17_500);
  if (!provider || !model) return { ok: false, error: "ai_model_missing" };

  try {
    const apiKey = credentialId
      ? (await loadCredential(credentialId, activeOrg.orgId)).apiKey
      : chaveDePlataforma(provider);
    if (!apiKey) return { ok: false, error: "ai_credential_missing" };
    const result = await generateText({
      model: buildModel(provider, apiKey, model),
      system:
        "Você revisa o prompt de um agente de atendimento. Devolva somente o prompt completo revisado, sem markdown. Preserve regras de opt-out, handoff humano, não invenção de dados e uso exclusivo de informações confirmadas. Não prometa ações ou ferramentas que o texto atual não oferece.",
      prompt: `PROMPT ATUAL:\n${base}\n\nPEDIDO DO GESTOR:\n${pedido}`,
      maxOutputTokens: 2_500,
    });
    const proposed = result.text.trim();
    if (!proposed) return { ok: false, error: "ai_empty_response" };
    return {
      ok: true,
      prompt: proposed,
      summary: ["Diretrizes do atendimento ajustadas pela conversa com a IA"],
    };
  } catch {
    return { ok: false, error: "ai_generation_failed" };
  }
}
