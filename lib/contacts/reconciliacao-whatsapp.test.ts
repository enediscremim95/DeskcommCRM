import { describe, expect, it, vi } from "vitest";

import {
  JANELA_RECONCILIACAO_WHATSAPP_DIAS,
  reconciliarContatoWhatsappComFormulario,
} from "@/lib/contacts/reconciliacao-whatsapp";

describe("reconciliarContatoWhatsappComFormulario", () => {
  it("mantém a janela aprovada em uma constante e envia a organização para a RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { outcome: "merged", contact_id: "contato-whatsapp" },
      error: null,
    });
    const resultado = await reconciliarContatoWhatsappComFormulario({ rpc } as never, {
      organizationId: "org-1",
      whatsappContactId: "contato-whatsapp",
      externalMessageId: "mensagem-1",
    });

    expect(JANELA_RECONCILIACAO_WHATSAPP_DIAS).toBe(7);
    expect(rpc).toHaveBeenCalledWith("fn_reconciliar_contato_whatsapp_formulario", {
      p_organization_id: "org-1",
      p_contato_whatsapp: "contato-whatsapp",
      p_external_message_id: "mensagem-1",
      p_janela_dias: 7,
    });
    expect(resultado?.outcome).toBe("merged");
  });

  it("falha baixo quando a reconciliação não está disponível", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "indisponível" } });
    await expect(
      reconciliarContatoWhatsappComFormulario({ rpc } as never, {
        organizationId: "org-1",
        whatsappContactId: "contato-whatsapp",
        externalMessageId: "mensagem-1",
      }),
    ).resolves.toBeNull();
  });
});
