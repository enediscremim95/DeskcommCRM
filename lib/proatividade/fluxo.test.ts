import { describe, it, expect, vi } from "vitest";
import { configProatividadeSchema, lerProatividade, emExpediente } from "./config";
import { executarPasso, type PortasProatividade, type Tentativa } from "./fluxo";
import { corrigirTelefoneFormulario } from "@/lib/channels/telefone-formulario";
const now = new Date("2026-11-16T14:00:00Z");
const config = configProatividadeSchema.parse({
  enabled: true,
  channel_session_id: "ffffffff-0000-4000-8000-000000000001",
});
function ports(): PortasProatividade {
  return {
    elegivel: vi.fn().mockResolvedValue(true),
    reservar: vi.fn().mockResolvedValue(true),
    enviar: vi.fn().mockResolvedValue("failed"),
    concluir: vi.fn().mockResolvedValue(undefined),
    atencao: vi.fn().mockResolvedValue(undefined),
  };
}
const failed = (phase: Tentativa["phase"]): Tentativa => ({
  phase,
  outcome: "failed",
  created_at: now.toISOString(),
});
describe("primeiro contato, transportes inteiramente simulados", () => {
  it.each([undefined, {}, { form_proactivity: { enabled: false } }])(
    "ausência/config desligada nunca envia: %s",
    async (settings) => {
      const p = ports();
      await executarPasso(lerProatividade(settings), "America/Sao_Paulo", [], p, now);
      expect(p.enviar).not.toHaveBeenCalled();
    },
  );
  it("domingo e fora do expediente reagendam sem enviar", async () => {
    const p = ports();
    for (const date of ["2026-11-15T14:00Z", "2026-11-16T22:00Z"])
      expect(await executarPasso(config, "America/Sao_Paulo", [], p, new Date(date))).toBe("retry");
    expect(p.enviar).not.toHaveBeenCalled();
  });
  it("usa o fuso da organização", () => {
    expect(emExpediente(new Date("2026-11-16T20:00Z"), "America/Sao_Paulo", config)).toBe(true);
    expect(emExpediente(new Date("2026-11-16T20:00Z"), "UTC", config)).toBe(false);
  });
  it.each([
    [[], "whatsapp"],
    [[failed("whatsapp")], "whatsapp_corrigido"],
    [[failed("whatsapp"), failed("whatsapp_corrigido")], "email"],
  ] as const)("falha avança para fase correta", async (attempts, phase) => {
    const p = ports();
    await executarPasso(config, "America/Sao_Paulo", [...attempts], p, now);
    expect(p.enviar).toHaveBeenCalledWith(phase);
    expect(p.concluir).toHaveBeenCalledWith(phase, "failed");
  });
  it("3 falhas aplicam atenção sem quarta tentativa", async () => {
    const p = ports();
    await executarPasso(
      config,
      "America/Sao_Paulo",
      [failed("whatsapp"), failed("whatsapp_corrigido"), failed("email")],
      p,
      now,
    );
    expect(p.enviar).not.toHaveBeenCalled();
    expect(p.atencao).toHaveBeenCalledOnce();
  });
  it("êxito interrompe sequência", async () => {
    const p = ports();
    await executarPasso(
      config,
      "America/Sao_Paulo",
      [{ ...failed("whatsapp"), outcome: "sent" }],
      p,
      now,
    );
    expect(p.enviar).not.toHaveBeenCalled();
    expect(p.atencao).not.toHaveBeenCalled();
  });
  it("resposta, opt-out, fechamento ou org desligada impedem envio", async () => {
    const p = ports();
    vi.mocked(p.elegivel).mockResolvedValue(false);
    await executarPasso(config, "America/Sao_Paulo", [], p, now);
    expect(p.enviar).not.toHaveBeenCalled();
  });
  it("revalida resposta após claim", async () => {
    const p = ports();
    vi.mocked(p.elegivel).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await executarPasso(config, "America/Sao_Paulo", [], p, now);
    expect(p.enviar).not.toHaveBeenCalled();
  });
  it("claim concorrente não envia", async () => {
    const p = ports();
    vi.mocked(p.reservar).mockResolvedValue(false);
    await executarPasso(config, "America/Sao_Paulo", [], p, now);
    expect(p.enviar).not.toHaveBeenCalled();
  });
  it("envio incerto sinaliza atenção e não inicia fallback duplicado", async () => {
    const p = ports();
    vi.mocked(p.enviar).mockRejectedValue(new Error("timeout"));
    expect(await executarPasso(config, "America/Sao_Paulo", [], p, now)).toBe("done");
    expect(p.concluir).toHaveBeenCalledWith("whatsapp", "uncertain");
    expect(p.atencao).toHaveBeenCalledOnce();
  });
  it("claim abandonado não causa reenvio após crash", async () => {
    const p = ports();
    await executarPasso(
      config,
      "America/Sao_Paulo",
      [{ phase: "whatsapp", outcome: "started", created_at: "2026-11-16T13:00Z" }],
      p,
      now,
    );
    expect(p.enviar).not.toHaveBeenCalled();
    expect(p.atencao).toHaveBeenCalledOnce();
  });
  it("limite por organização é respeitado", async () => {
    const p = ports();
    await executarPasso(
      { ...config, max_attempts: 1 },
      "America/Sao_Paulo",
      [failed("whatsapp")],
      p,
      now,
    );
    expect(p.enviar).not.toHaveBeenCalled();
    expect(p.atencao).toHaveBeenCalledOnce();
  });
  it.each([
    "41999799652",
    "554199799652",
    "555541999799652",
    "05541999799652".slice(1),
    "55419999799652",
  ])("corrige somente estrutura conhecida: %s", (raw) => {
    expect(corrigirTelefoneFormulario(raw)).toBe("+5541999799652");
  });
  it("dígito arbitrário faltante/sobrando exige atenção, sem inventar destinatário", () => {
    expect(corrigirTelefoneFormulario("+55419997996")).toBeNull();
    expect(corrigirTelefoneFormulario("55412999799652")).toBeNull();
  });
});
