import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), realtime: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { info: mocks.toast } }));
vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({ useRealtimeChannel: mocks.realtime }));
import { InterfaceRefresh } from "./InterfaceRefresh";
const a = { orgId: "a", name: "A", role: "agent" as const, interface_settings: { preset: "completa" as const } };
const accessA = "1:access-a";
const accessAB = "2:access-a-b";
const props = {
  userId: "user",
  org: a,
  support: false,
  organizationsCount: 1,
  organizationsSignature: accessA,
};
const fetcher = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const response = (
  org: string,
  preset = "simplificada",
  organizationsSignature = accessA,
  organizationsCount = 1,
) => ({
  ok: true,
  json: async () => ({
    data: {
      organization_id: org,
      signature: JSON.stringify({ preset }),
      organizations_count: organizationsCount,
      organizations_signature: organizationsSignature,
    },
  }),
});
it("invalidações durante leitura antiga provocam uma releitura fresca, sem esperar polling", async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  fetcher.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(response("a"));
  render(<InterfaceRefresh {...props} />);
  await act(async () => { mocks.realtime.mock.lastCall![0].onChange({}); });
  await act(async () => {
    mocks.realtime.mock.lastCall![0].onChange({});
    mocks.realtime.mock.lastCall![0].onChange({});
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await act(async () => { resolveOld(response("a", "completa")); });
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(mocks.toast).toHaveBeenCalledOnce();
});
it("invalidação pendente de A não relê nem interfere na consulta em voo de B", async () => {
  let resolveA!: (value: ReturnType<typeof response>) => void;
  let resolveB!: (value: ReturnType<typeof response>) => void;
  fetcher.mockReturnValueOnce(new Promise(resolve => { resolveA = resolve; }))
    .mockReturnValueOnce(new Promise(resolve => { resolveB = resolve; }))
    .mockResolvedValueOnce(response("b"));
  const view = render(<InterfaceRefresh {...props} />);
  await act(async () => {
    mocks.realtime.mock.lastCall![0].onChange({});
    mocks.realtime.mock.lastCall![0].onChange({});
  });
  view.rerender(<InterfaceRefresh {...props} org={{ ...a, orgId: "b" }} />);
  await act(async () => { mocks.realtime.mock.lastCall![0].onChange({}); });
  await act(async () => { resolveA(response("a")); });
  await act(async () => { mocks.realtime.mock.lastCall![0].onChange({}); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(mocks.refresh).not.toHaveBeenCalled();
  await act(async () => { resolveB(response("b", "completa")); });
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("desmontar descarta a invalidação pendente sem nova consulta ou refresh", async () => {
  let resolveOld!: (value: ReturnType<typeof response>) => void;
  fetcher.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
  const view = render(<InterfaceRefresh {...props} />);
  await act(async () => {
    mocks.realtime.mock.lastCall![0].onChange({});
    mocks.realtime.mock.lastCall![0].onChange({});
  });
  view.unmount();
  await act(async () => { resolveOld(response("a")); });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("evento é só invalidação: relê contexto autenticado e refresh preserva documento", async () => {
  fetcher.mockResolvedValue(response("a"));
  render(<InterfaceRefresh {...props} />);
  await act(async () => { mocks.realtime.mock.lastCall![0].onChange({ interface_settings: { preset: "fake" } }); });
  expect(fetcher).toHaveBeenCalledWith("/api/v1/auth/interface", { cache: "no-store" });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalled();
});
it("resposta atrasada de A não atualiza contexto após trocar para B", async () => {
  let resolve!: (v: unknown) => void;
  fetcher.mockReturnValue(new Promise(r => { resolve = r; }));
  const view = render(<InterfaceRefresh {...props} />);
  await act(async () => { mocks.realtime.mock.lastCall![0].onChange({}); });
  view.rerender(<InterfaceRefresh {...props} org={{ ...a, orgId: "b" }} />);
  await act(async () => { resolve(response("a")); });
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("foco cobre evento perdido, suporte não assina nem consulta preferência de membro", async () => {
  fetcher.mockResolvedValue(response("a"));
  const view = render(<InterfaceRefresh {...props} />);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  view.rerender(<InterfaceRefresh {...props} support />);
  expect(mocks.realtime.mock.lastCall![0].enabled).toBe(false);
  fetcher.mockClear();
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(fetcher).not.toHaveBeenCalled();
});

it("ganhar acesso atualiza o shell, avisa e mantém a organização ativa", async () => {
  fetcher.mockResolvedValue(response("a", "completa", accessAB, 2));
  render(<InterfaceRefresh {...props} />);

  await act(async () => { window.dispatchEvent(new Event("focus")); });

  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalledWith(
    "Você recebeu acesso a outra organização. Use o seletor para escolher onde trabalhar.",
    { id: "organizations-updated" },
  );
  expect(mocks.realtime.mock.lastCall![0].postgresChanges.event).toBe("*");
  expect(mocks.realtime.mock.lastCall![0].name).toBe("interface:user:a");
});

it("perder acesso fora da organização ativa atualiza o shell e avisa", async () => {
  fetcher.mockResolvedValue(response("a", "completa", accessA, 1));
  render(
    <InterfaceRefresh
      {...props}
      organizationsCount={2}
      organizationsSignature={accessAB}
    />,
  );

  await act(async () => { window.dispatchEvent(new Event("focus")); });

  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(mocks.toast).toHaveBeenCalledWith(
    "Sua lista de organizações foi atualizada. Você pode continuar nesta tela.",
    { id: "organizations-updated" },
  );
});
