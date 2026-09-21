import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SystemVersion } from "@/hooks/system/useSystemVersion";

let versao: SystemVersion;

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/i18n/useT", () => ({ useT: () => (texto: string) => texto }));
vi.mock("@/hooks/system/useSystemVersion", () => ({
  useSystemVersion: () => ({ data: versao, isError: false }),
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
}));

describe("UpdatePanel", () => {
  beforeEach(() => {
    versao = {
      current_version: "1.6.0-veritas.29",
      latest_version: "1.6.0-veritas.29",
      update_available: false,
      off_release: false,
      is_owner: true,
      agent_online: true,
      run: {
        id: "run-antigo",
        status: "failed",
        last_step: "banco",
        from_version: "1.6.0-veritas.25",
        to_version: "1.6.0-veritas.26",
        log_tail: "Conflict. The container name is already in use",
        superseded: true,
      },
    };
  });

  it("mostra falha superada como histórico, sem emergência nem downgrade", async () => {
    const { UpdatePanel } = await import("./UpdatePanel");
    const html = renderToStaticMarkup(<UpdatePanel />);

    expect(html).toContain("Você está na versão 1.6.0-veritas.29");
    expect(html).toContain("já foi superada");
    expect(html).toContain("Detalhes técnicos");
    expect(html).not.toContain("fora do ar");
    expect(html).not.toContain("--to v1.6.0-veritas.25 --force");
  });

  it("mantém o alerta e a saída manual quando a falha ainda é atual", async () => {
    if (versao.run) versao.run.superseded = false;
    const { UpdatePanel } = await import("./UpdatePanel");
    const html = renderToStaticMarkup(<UpdatePanel />);

    expect(html).toContain("pode estar rodando a versão");
    expect(html).toContain("--to v1.6.0-veritas.25 --force");
  });
});
