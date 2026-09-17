import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnerAccessStatus } from "./OwnerAccessStatus";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ apiClient: api }));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (text: string) => text }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><OwnerAccessStatus tenantId="tenant-123" /></QueryClientProvider>);
}
const failed = { status: "failed", login_url: "https://crm.example/login", retryable: true };
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("acesso do responsável", () => {
  it("recupera falha após reabrir a organização e repete só o envio", async () => {
    api.get.mockResolvedValueOnce({ data: { owner_access: failed } }).mockResolvedValue({ data: { owner_access: { ...failed, status: "sent", retryable: false } } });
    api.post.mockResolvedValue({ data: { owner_access: { ...failed, status: "sent", retryable: false } } });
    renderStatus();
    fireEvent.click(await screen.findByRole("button", { name: "Tentar enviar acesso novamente" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/api/v1/admin/tenants/tenant-123/owner-access", undefined));
    expect(await screen.findByText(/aceitou o envio/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Tentar enviar acesso novamente" })).toBeNull();
  });
  it("não afirma sucesso se não consegue consultar o estado", async () => {
    api.get.mockRejectedValue(new Error("offline"));
    renderStatus();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText(/aceitou o envio/)).toBeNull();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeTruthy();
  });
  it("não oferece envio de senha para conta existente", async () => {
    api.get.mockResolvedValue({ data: { owner_access: { ...failed, status: "existing_user", retryable: false } } });
    renderStatus();
    expect(await screen.findByText(/mantém sua senha/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
