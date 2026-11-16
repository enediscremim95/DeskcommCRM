import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  lerEstadoDoAssistente,
  provisionarAssistenteDeResposta,
} from "@/lib/ai/assistente-de-resposta/provisionar";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/assistente-de-resposta/provisionar", () => ({
  desligarAssistenteDeResposta: vi.fn(),
  lerEstadoDoAssistente: vi.fn(),
  provisionarAssistenteDeResposta: vi.fn(),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ORG_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const CREDENTIAL_ID = "44444444-4444-4444-8444-444444444444";
const CHANNEL_ID = "55555555-5555-4555-8555-555555555555";
const AGENT_ID = "66666666-6666-4666-8666-666666666666";
const MODEL = "anthropic/claude-haiku-5.5";

interface CredentialRow {
  id: string;
  organization_id: string;
  provider: string;
  is_active: boolean;
  validated_at: string | null;
  validation_error: string | null;
  models_available: string[] | null;
}

function adminStub(credential: CredentialRow | null, catalog: unknown[] = []) {
  return {
    from(table: string) {
      if (table === "ai_provider_credentials_safe") {
        const filters = new Map<string, unknown>();
        const builder = {
          select() {
            return builder;
          },
          eq(field: string, value: unknown) {
            filters.set(field, value);
            return builder;
          },
          maybeSingle() {
            const pertence =
              credential?.organization_id === filters.get("organization_id") &&
              credential?.id === filters.get("id");
            return Promise.resolve({ data: pertence ? credential : null, error: null });
          },
        };
        return builder;
      }
      if (table === "ai_models") {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          is() {
            return builder;
          },
          order() {
            return Promise.resolve({ data: catalog, error: null });
          },
        };
        return builder;
      }
      if (table === "channel_sessions") {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          is() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          maybeSingle() {
            return Promise.resolve({ data: { id: CHANNEL_ID }, error: null });
          },
        };
        return builder;
      }
      throw new Error(`tabela inesperada: ${table}`);
    },
  };
}

function request() {
  return new NextRequest("http://localhost/api/v1/ai/reply-assistant", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      provider: "openrouter",
      credential_id: CREDENTIAL_ID,
      team_style: "Fale de forma curta, cordial e humana.",
      history_message_window: 20,
      history_token_window: 4_000,
      hourly_limit: 20,
      daily_limit: 100,
      auto_suggest: true,
    }),
  });
}

const ESTADO_DESLIGADO = {
  agent_id: null,
  enabled: false,
  state: "off" as const,
  provider: "anthropic" as const,
  credential_id: null,
  credential_last4: null,
  validation_error: null,
  team_style: "Fale de forma curta, cordial e humana.",
  history_message_window: 20,
  history_token_window: 4_000,
  hourly_limit: 20,
  daily_limit: 100,
  auto_suggest: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: USER_ID, idioma: "pt-BR" },
    org: { orgId: ORG_ID, role: "admin" },
  } as never);
  vi.mocked(lerEstadoDoAssistente).mockResolvedValue(ESTADO_DESLIGADO);
  vi.mocked(provisionarAssistenteDeResposta).mockResolvedValue({
    ok: true,
    agentId: AGENT_ID,
    versionId: "77777777-7777-4777-8777-777777777777",
  });
});

describe("PUT /api/v1/ai/reply-assistant com OpenRouter", () => {
  it("aceita credencial validada da própria organização e audita sem chave", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({
        id: CREDENTIAL_ID,
        organization_id: ORG_ID,
        provider: "openrouter",
        is_active: true,
        validated_at: "2026-11-06T12:00:00.000Z",
        validation_error: null,
        // Prova o fallback seguro quando o cron do catálogo ainda não rodou.
        models_available: [MODEL],
      }) as never,
    );

    const { PUT } = await import("./route");
    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect(provisionarAssistenteDeResposta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: ORG_ID,
        provider: "openrouter",
        model: MODEL,
        credential_id: CREDENTIAL_ID,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai_reply_assistant.enabled",
        organizationId: ORG_ID,
        resourceId: AGENT_ID,
        metadata: expect.objectContaining({ provider: "openrouter", model: MODEL }),
      }),
    );
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("sk-or-");
  });

  it("recusa credencial de outra organização", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({
        id: CREDENTIAL_ID,
        organization_id: OTHER_ORG_ID,
        provider: "openrouter",
        is_active: true,
        validated_at: "2026-11-06T12:00:00.000Z",
        validation_error: null,
        models_available: [MODEL],
      }) as never,
    );

    const { PUT } = await import("./route");
    const response = await PUT(request());
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("credential_not_found");
    expect(provisionarAssistenteDeResposta).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("recusa credencial OpenRouter ainda não validada", async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      adminStub({
        id: CREDENTIAL_ID,
        organization_id: ORG_ID,
        provider: "openrouter",
        is_active: true,
        validated_at: null,
        validation_error: "auth_failed_401",
        models_available: null,
      }) as never,
    );

    const { PUT } = await import("./route");
    const response = await PUT(request());
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("credential_not_validated");
    expect(provisionarAssistenteDeResposta).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
