import { describe, expect, it } from "vitest";

import {
  BENDITO_CHANNEL_SESSION_ID,
  BENDITO_ORG_ID,
  NOME_REGRA_ABERTURA_BENDITO,
  TEMPLATE_ABERTURA_BENDITO,
  idRegraAberturaBendito,
  leadCasariaNaAbertura,
  montarRegraAberturaBendito,
  validarOrganizacaoBendito,
} from "@/scripts/criar-regra-abertura-bendito";

describe("regra de abertura da Bendito", () => {
  it("exclui lead que chegou pelo WhatsApp", () => {
    expect(leadCasariaNaAbertura({ source: "whatsapp" })).toBe(false);
  });

  it("inclui lead que chegou por webhook", () => {
    expect(leadCasariaNaAbertura({ source: "webhook" })).toBe(true);
  });

  it("gera o mesmo id determinístico em reexecuções", () => {
    expect(idRegraAberturaBendito(BENDITO_ORG_ID)).toBe(idRegraAberturaBendito(BENDITO_ORG_ID));
  });

  it("monta uma única abertura desligada, com canal e texto exatos", () => {
    const regra = montarRegraAberturaBendito(BENDITO_ORG_ID);

    expect(regra).toMatchObject({
      id: idRegraAberturaBendito(BENDITO_ORG_ID),
      organization_id: BENDITO_ORG_ID,
      name: NOME_REGRA_ABERTURA_BENDITO,
      trigger_event: "lead.created",
      conditions: [{ field: "lead.source", op: "neq", value: "whatsapp" }],
      actions: [
        {
          type: "send_whatsapp_message",
          config: {
            channel_session_id: BENDITO_CHANNEL_SESSION_ID,
            template: TEMPLATE_ABERTURA_BENDITO,
          },
        },
      ],
      is_active: false,
    });
  });

  it("recusa organização diferente antes de montar a regra", () => {
    const outraOrg = "11111111-1111-4111-8111-111111111111";
    expect(() => validarOrganizacaoBendito(outraOrg)).toThrow("TRAVA DE ORGANIZAÇÃO");
    expect(() => montarRegraAberturaBendito(outraOrg)).toThrow("TRAVA DE ORGANIZAÇÃO");
  });
});
