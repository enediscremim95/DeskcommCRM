import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ImpersonateBanner } from "./ImpersonateBanner";

const assign = vi.fn();
const cancel = vi.fn();
const toastError = vi.fn();
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("@/components/shell/OrganizationTransitionProvider", () => ({
  useOrganizationTransition: () => ({ begin: vi.fn(), cancel }),
}));
vi.mock("sonner", () => ({ toast: { error: (...args: unknown[]) => toastError(...args) } }));

beforeEach(() => {
  vi.clearAllMocks();
  const realWindow = window;
  vi.stubGlobal("window", new Proxy(realWindow, {
    get(target, property) {
      if (property === "location") return { ...target.location, assign };
      return Reflect.get(target, property, target);
    },
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open() {
  render(<ImpersonateBanner impersonating={{ tenantId: "org-b", tenantName: "Empresa B",
    expiresAt: new Date(Date.now() + 60_000).toISOString() }} />);
  fireEvent.click(screen.getByRole("button", { name: "Sair do acompanhamento" }));
}

it("espera o corpo da confirmação antes de anunciar a troca e navegar", async () => {
  let resolve!: (body: unknown) => void;
  const json = vi.fn(() => new Promise(done => { resolve = done; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json }));
  const storage = vi.spyOn(Storage.prototype, "setItem");
  try {
    open();
    await waitFor(() => expect(json).toHaveBeenCalledOnce());
    expect(assign).not.toHaveBeenCalled();
    expect(storage).not.toHaveBeenCalledWith("support-context-transition", expect.any(String));
    expect(screen.getByRole("button", { name: "Sair do acompanhamento" })).toBeDisabled();
    resolve({ data: { ended: true, redirect_url: "/app/kanban" } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/app/kanban"));
    expect(storage).toHaveBeenCalledWith("support-context-transition", expect.any(String));
  } finally { storage.mockRestore(); }
});

it("resposta interrompida não anuncia saída nem navega e permite tentar outra vez", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true,
    json: vi.fn().mockRejectedValue(new Error("resposta interrompida")) }));
  open();
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(assign).not.toHaveBeenCalled();
  expect(toastError).toHaveBeenCalledWith("resposta interrompida");
  expect(screen.getByRole("button", { name: "Sair do acompanhamento" })).toBeEnabled();
});

it("recusa HTTP não é tratada como encerramento confirmado", async () => {
  const json = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json }));
  open();
  await waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  expect(json).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
  expect(toastError).toHaveBeenCalledOnce();
});
