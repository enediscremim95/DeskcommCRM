import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("página completa do lead", () => {
  const pagina = readFileSync("app/app/leads/[id]/page.tsx", "utf8");
  const cliente = readFileSync("components/leads/LeadPageClient.tsx", "utf8");
  const board = readFileSync("components/kanban/KanbanBoard.tsx", "utf8");

  it("renderiza a tela do lead em vez de redirecionar ao quadro", () => {
    expect(pagina).toContain("<LeadPageClient");
    expect(pagina).not.toContain("redirect(`/app/pipelines/");
  });

  it("reaproveita ChatThread e Composer na mesma superfície", () => {
    expect(cliente).toMatch(/<ChatThread[\s\S]*contextItems=\{contextItems\}/);
    expect(cliente).toMatch(/<Composer[\s\S]*conversationId=\{selectedConversation\.id\}/);
  });

  it("diferencia canal ausente de lead ainda sem conversa", () => {
    expect(cliente).toContain("WhatsApp não conectado");
    expect(cliente).toContain("Este lead ainda não tem conversa no WhatsApp");
    expect(cliente).toContain('href="/app/connections"');
  });

  it("só libera resposta quando o canal da própria conversa está conectado", () => {
    expect(pagina).toContain("channel.id === conversationResult.data?.channel_session_id");
    expect(cliente).toContain("!canReplyInConversation");
  });

  it("o clique no card abre a URL estável do lead", () => {
    expect(board).toContain("router.push(`/app/leads/${leadId}`)");
  });
});
