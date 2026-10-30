import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { agenteAtende } from "@/lib/ai/agents/no-ar";
import {
  loadPublishedAgentConfig,
  loadPublishedAgentConfigById,
} from "@/lib/agent-engine/agent/agent-config";
import { provisionarAssistenteDeResposta } from "@/lib/ai/assistente-de-resposta/provisionar";

describe("assistente de resposta não envia sozinho", () => {
  it("não entra na seleção de turnos inbound", () => {
    expect(loadPublishedAgentConfig.toString()).toContain("reply_assistant");
    expect(loadPublishedAgentConfig.toString()).toContain("managed");
    expect(loadPublishedAgentConfigById.toString()).toContain("allowManagedReplyAssistant");
  });

  it("a publicação interna continua aparecendo como parada para o produto", () => {
    expect(
      agenteAtende({
        kind: "mcp_agent",
        operation_mode: "assisted",
        is_active: false,
        paused_at: "2026-10-29T12:00:00.000Z",
        published_version_id: "11000000-0000-4000-8000-000000000001",
        archived_at: null,
      }),
    ).toBe(false);
  });

  it("provisionar não cria job, mensagem nem chama a cadeia de envio", () => {
    const source = provisionarAssistenteDeResposta.toString();
    expect(source).not.toContain("job_queue");
    // `history_message_window` é configuração de contexto, não acesso à tabela
    // de mensagens. A trava precisa procurar a operação, não a palavra solta.
    expect(source).not.toMatch(/\.from\(["']messages["']\)/);
    expect(source).not.toContain("fn_reply_action");
    expect(source).not.toContain("send_");
  });

  it("a rota de configuração não toca na cadeia de envio", () => {
    const source = readFileSync("app/api/v1/ai/reply-assistant/route.ts", "utf8");
    expect(source).not.toMatch(/job_queue|fn_reply_action|send_whatsapp|approved_reply/);
  });

  it("gerar ou apenas mostrar a sugestão não toca na cadeia de envio", () => {
    const route = readFileSync("app/api/v1/conversations/[id]/draft-reply/route.ts", "utf8");
    const hook = readFileSync("hooks/inbox/useReplySuggestion.ts", "utf8");
    expect(route).not.toMatch(/job_queue|approved_reply|send_whatsapp/);
    expect(hook).not.toContain('apiClient.post<{ data: Message }>("/api/v1/messages"');
    expect(hook).toContain("{ trigger }");
  });

  it("o worker assistido exclui o agente interno mesmo depois da publicação", () => {
    const source = readFileSync("lib/agent-engine/edge/crm/drain.ts", "utf8");
    expect(source).toContain("reply_assistant");
    expect(source).toContain("managed");
  });
});
