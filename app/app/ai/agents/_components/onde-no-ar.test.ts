import { describe, expect, it } from "vitest";

import type { AgentRow } from "@/hooks/ai/useAgent";

import { ondeNoAr } from "./onde-no-ar";

const base = {
  id: "agent-1",
  organization_id: "org-1",
  name: "Vitória",
  description: null,
  model: "anthropic/claude-sonnet-4-6",
  system_prompt: "Atenda bem.",
  is_active: true,
  is_default: false,
  kind: "mcp_agent",
  priority: 10,
  published_version_id: "version-3",
  paused_at: null,
  archived_at: null,
  config: {},
  guardrails: {},
  active_kb_version_id: null,
  created_at: "2026-11-01T12:00:00Z",
  updated_at: "2026-11-04T12:00:00Z",
  versao_publicada: {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    version_number: 3,
    published_at: "2026-11-04T12:00:00Z",
    channel_session_id: "channel-1",
    canal: {
      id: "channel-1",
      phone_number: "+5511925820546",
      display_name: "Comercial",
      status: "WORKING",
      automatic_attendance_enabled: true,
    },
  },
} satisfies AgentRow;

describe("ondeNoAr", () => {
  it("mostra o agente no ar, o telefone formatado e a versão publicada", () => {
    expect(ondeNoAr(base)).toEqual({
      estado: "no_ar",
      tom: "success",
      statusTexto: "No ar",
      canalTexto: "+55 11 92582-0546",
      versaoTexto: "versão 3, publicada em 04/11",
    });
  });

  it("avisa quando o automático está desligado no canal conectado", () => {
    const agent = {
      ...base,
      versao_publicada: {
        ...base.versao_publicada,
        canal: { ...base.versao_publicada.canal, automatic_attendance_enabled: false },
      },
    };

    expect(ondeNoAr(agent).estado).toBe("automatico_desligado");
    expect(ondeNoAr(agent).statusTexto).toBe(
      "Publicado, mas o atendimento automático está desligado neste número",
    );
  });

  it("avisa quando o canal publicado está desconectado", () => {
    const agent = {
      ...base,
      versao_publicada: {
        ...base.versao_publicada,
        canal: { ...base.versao_publicada.canal, status: "STOPPED" },
      },
    };

    expect(ondeNoAr(agent).estado).toBe("desconectado");
    expect(ondeNoAr(agent).statusTexto).toBe("Publicado, mas o número está desconectado");
  });

  it("mostra que não está no ar quando não há versão publicada", () => {
    const agent = { ...base, published_version_id: null, versao_publicada: null };

    expect(ondeNoAr(agent)).toEqual({
      estado: "fora_do_ar",
      tom: "neutral",
      statusTexto: "Não está no ar",
      canalTexto: null,
      versaoTexto: null,
    });
  });

  it("mostra que não está no ar quando a versão publicada não tem canal", () => {
    const agent = {
      ...base,
      versao_publicada: { ...base.versao_publicada, canal: null },
    };

    expect(ondeNoAr(agent).estado).toBe("fora_do_ar");
    expect(ondeNoAr(agent).canalTexto).toBe("Canal não encontrado");
  });

  it("usa o nome do canal quando o telefone é nulo", () => {
    const agent = {
      ...base,
      versao_publicada: {
        ...base.versao_publicada,
        canal: { ...base.versao_publicada.canal, phone_number: null },
      },
    };

    expect(ondeNoAr(agent).canalTexto).toBe("Comercial");
  });

  it("um agente pausado não está no ar, mesmo com versão e canal disponíveis", () => {
    expect(ondeNoAr({ ...base, paused_at: "2026-11-04T13:00:00Z" }).estado).toBe("fora_do_ar");
  });

  it("um agente arquivado não está no ar, mesmo com versão e canal disponíveis", () => {
    expect(ondeNoAr({ ...base, archived_at: "2026-11-04T13:00:00Z" }).estado).toBe("fora_do_ar");
  });
});
