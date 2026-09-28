import { describe, expect, it } from "vitest";

import { resumoDaRegra, resumoDasTravas } from "./RulesTab";
import type { AutomationRuleRow } from "@/hooks/webhooks/useAutomationRules";
import { canalDeTeste } from "@/lib/channels/fixture-de-teste";

const t = (texto: string) => texto;
const REGRA: AutomationRuleRow = {
  id: "1",
  organization_id: "org",
  name: "Follow-up",
  trigger_event: "lead.stage_changed",
  conditions: [{ field: "event.to_stage_id", op: "eq", value: "stage-follow" }],
  actions: [
    {
      type: "send_whatsapp_message",
      config: { channel_session_id: "canal-1", template: "Olá, ainda posso ajudar?" },
    },
  ],
  is_active: false,
  last_run_at: null,
  run_count: 0,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  last_change_actor_kind: null,
  last_change_at: null,
};

describe("leitura simples das automações", () => {
  it("explica a regra como QUANDO e ENTÃO com o nome da etapa", () => {
    const frase = resumoDaRegra(
      REGRA,
      [{ id: "stage-follow", name: "Follow-up", position: 2 } as never],
      t,
    );
    expect(frase).toContain("QUANDO o lead entrar na etapa “Follow-up”");
    expect(frase).toContain("ENTÃO mande a mensagem");
  });

  it("mostra janela, consentimento, limite e o número que será protegido", () => {
    const frase = resumoDasTravas(
      REGRA,
      [canalDeTeste({ daily_message_limit: 120 })],
      t,
    );
    expect(frase).toBe(
      "RESPEITANDO a janela de horário, o consentimento e o limite diário de 120 mensagens do número Comercial Curitiba.",
    );
  });

  it("explica a remoção de tag na leitura simples da regra", () => {
    const frase = resumoDaRegra(
      { ...REGRA, actions: [{ type: "remove_tag", config: { tags: ["aguardando_resposta"] } }] },
      [],
      t,
    );
    expect(frase).toContain("ENTÃO remova a tag configurada");
  });
});
