import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManagedQrConnector } from "./ManagedQrConnector";

const connector = {
  id: "20000000-0000-4000-8000-000000000002",
  provider_label: "Conector externo",
  instance_name: "existing-instance",
  phone_number: "5541999999999",
  display_name: "WhatsApp comercial",
  remote_state: "close" as const,
  qr_attempts: 0,
  client_can_reconnect: true,
  hook_last_status: null,
  hook_last_error: null,
};

function json(data: unknown, status = 200, headers?: HeadersInit) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  }));
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/managed/qr") && init?.method === "POST") {
      return json({ data: { qr_base64: "cG5n", pairing_code: "12345678", expires_in: 60, attempts: 1 } });
    }
    if (url.endsWith("/managed/state") && init?.method === "POST") return json({ data: connector });
    return json({ data: connector });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("conexão QR gerenciada", () => {
  it("mostra queda e só pede QR depois do clique", async () => {
    render(<ManagedQrConnector fallback={<p>Conector padrão</p>} />);
    expect(await screen.findByText("WhatsApp desconectado")).toBeTruthy();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/managed/qr"))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Gerar QR para reconectar" }));
    expect(await screen.findByAltText("QR temporário para reconectar o WhatsApp")).toBeTruthy();
    expect(screen.getByText("12345678")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/managed/qr"))).toBe(true);
  });

  it("mantém organizações sem o conector no fluxo atual", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json({ data: null })));
    render(<ManagedQrConnector fallback={<p>Conector padrão</p>} />);
    expect(await screen.findByText("Conector padrão")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("WhatsApp desconectado")).toBeNull());
  });
});
