/**
 * `models_available` é `text[]` no banco e chegava tipado como `number` no
 * hook. O card imprimia o array inteiro colado por vírgula ("claude-a,claude-b")
 * onde deveria haver uma contagem.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CredentialCard } from "./CredentialCard";
import { apiClient } from "@/lib/api/client";
import type { CredentialRow } from "@/hooks/ai/useCredentials";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../_actions", () => ({ refreshCredentialsView: vi.fn() }));

export function credencial(extra: Partial<CredentialRow> = {}): CredentialRow {
  return {
    id: "c1",
    organization_id: "o1",
    provider: "anthropic",
    origem: "propria",
    label: "Produção",
    api_key_last4: "abcd",
    validated_at: "2026-09-02T00:00:00Z",
    validation_error: null,
    models_available: null,
    is_active: true,
    created_by: null,
    created_at: "2026-09-02T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    ...extra,
  };
}

export function montar(
  row: CredentialRow,
  props: { canWrite?: boolean; canDelete?: boolean; usageCount?: number } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CredentialCard
        credential={row}
        canWrite={props.canWrite ?? true}
        canDelete={props.canDelete ?? true}
        usageCount={props.usageCount ?? 0}
      />
    </QueryClientProvider>,
  );
}

describe("CredentialCard — modelos", () => {
  it("mostra a CONTAGEM de modelos, nunca a lista colada", () => {
    montar(credencial({ models_available: ["claude-a", "claude-b", "claude-c"] }));
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/claude-a,claude-b/)).toBeNull();
  });

  it("mostra travessão quando ainda não há lista", () => {
    montar(credencial({ models_available: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("CredentialCard — erro de validação", () => {
  it("401 vira frase e link para pegar chave nova", () => {
    montar(credencial({ validated_at: null, validation_error: "auth_failed_401" }));
    expect(screen.getByText(/recusou a chave/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pegar chave em/ })).toHaveAttribute(
      "href",
      "https://console.anthropic.com/settings/keys",
    );
    expect(screen.queryByText("auth_failed_401")).toBeNull();
  });

  it("erro de rede não oferece link: a chave não é o problema", () => {
    montar(credencial({ validated_at: null, validation_error: "network_error" }));
    expect(screen.queryByRole("link", { name: /Pegar chave em/ })).toBeNull();
  });
});

describe("CredentialCard — autoridade para exclusão", () => {
  it("mantém a revalidação, mas não oferece exclusão sem a capacidade nomeada", () => {
    montar(credencial(), { canWrite: true, canDelete: false });

    expect(screen.getByRole("button", { name: "Revalidar credencial" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir credencial" })).toBeNull();
  });
});

describe("CredentialCard — confirmação da troca", () => {
  it("identifica uma chave compartilhada pelo fornecedor, origem e final", () => {
    montar(credencial({ origem: "compartilhada", provider: "openrouter" }));
    expect(screen.getByText("OpenRouter · …abcd")).toBeInTheDocument();
    expect(screen.getByText("Compartilhada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Usar como padrão" })).toBeNull();
  });

  it("não oferece a troca para quem só lê", () => {
    montar(credencial(), { canWrite: false });
    expect(screen.queryByRole("button", { name: "Usar como padrão" })).toBeNull();
  });

  it("mostra o impacto e envia a escolha somente após confirmar", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({
      data: {
        provider: "anthropic", revision: "revisao-ficticia", current_model: "modelo-anterior",
        models: [{ id: "modelo-novo", name: "Modelo novo" }],
        agents: [{ id: "agente-1", name: "Atendimento", provider: "anthropic", model: "modelo-anterior" }],
        bindings: [{ id: "ponto-1", purpose: "sentiment_classify", provider: "anthropic", model: "modelo-anterior", is_enabled: true }],
        retained: ["followup_classify"],
      },
    });
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: { applied: true } });
    try {
      montar(credencial());
      fireEvent.click(screen.getByRole("button", { name: "Usar como padrão" }));
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText(/Atendimento.*nova versão publicada/)).toBeInTheDocument();
      expect(screen.getByText(/Medir o clima da conversa/)).toBeInTheDocument();
      expect(screen.getByText("Ler a resposta ao follow-up")).toBeInTheDocument();
      expect(screen.getByText(/Follow-ups redigidos pelo agente/)).toBeInTheDocument();
      const confirmar = screen.getByRole("button", { name: "Confirmar troca" });
      expect(confirmar).toBeDisabled();
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "modelo-novo" } });
      expect(post).not.toHaveBeenCalled();
      fireEvent.click(confirmar);
      await waitFor(() => expect(post).toHaveBeenCalledWith(
        "/api/v1/ai/credentials/c1/default",
        { model_id: "modelo-novo", revision: "revisao-ficticia" },
        { noRetryOnTimeout: true },
      ));
    } finally {
      get.mockRestore();
      post.mockRestore();
    }
  });
});
