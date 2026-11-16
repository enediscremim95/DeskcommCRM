import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { GOOGLE_EXPIRED_MESSAGE, recordGoogleConnectionFailure } from "./fallback";
import { GoogleHttpError } from "./transport";

type Chamada = { tabela: string; acao: "update" | "insert"; dados: Record<string, unknown> };

function bancoFalso(opcoes: { falhaAoAtualizar?: boolean } = {}) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string) {
      return {
        update(dados: Record<string, unknown>) {
          const cadeia = {
            eq: () => cadeia,
            then: (resolve: (v: { error: unknown }) => unknown) => {
              chamadas.push({ tabela, acao: "update", dados });
              return Promise.resolve(resolve({ error: opcoes.falhaAoAtualizar ? new Error("falhou") : null }));
            },
          };
          return cadeia;
        },
        insert(dados: Record<string, unknown>) {
          chamadas.push({ tabela, acao: "insert", dados });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, chamadas };
}

const args = (error: unknown) => ({
  organizationId: "org-1",
  connectionId: "conn-1",
  error,
  operation: "atualizar" as const,
});

describe("recordGoogleConnectionFailure", () => {
  it("credencial recusada (401) marca a conexão como expirada e abre o aviso", async () => {
    const { db, chamadas } = bancoFalso();
    await recordGoogleConnectionFailure(db, args(new GoogleHttpError(401)));

    expect(chamadas).toHaveLength(2);
    expect(chamadas[0]).toMatchObject({
      tabela: "calendar_connections",
      acao: "update",
      dados: { status: "token_expired", last_sync_error: GOOGLE_EXPIRED_MESSAGE },
    });
    expect(chamadas[1]).toMatchObject({ tabela: "agent_inbox_items", acao: "insert" });
  });

  it("conflito de versão (412) é caso comum e NÃO mexe na conexão", async () => {
    const { db, chamadas } = bancoFalso();
    await recordGoogleConnectionFailure(db, args(new GoogleHttpError(412)));
    expect(chamadas).toEqual([]);
  });

  it("evento que sumiu (404) NÃO rebaixa a conexão inteira", async () => {
    const { db, chamadas } = bancoFalso();
    await recordGoogleConnectionFailure(db, args(new GoogleHttpError(404)));
    expect(chamadas).toEqual([]);
  });

  it("não abre aviso quando a atualização da conexão falhou", async () => {
    const { db, chamadas } = bancoFalso({ falhaAoAtualizar: true });
    await recordGoogleConnectionFailure(db, args(new GoogleHttpError(401)));
    expect(chamadas.map((c) => c.tabela)).toEqual(["calendar_connections"]);
  });

  it("nunca lança, mesmo com um banco que não sabe o que é `from`", async () => {
    const semFrom = {} as unknown as SupabaseClient;
    await expect(recordGoogleConnectionFailure(semFrom, args(new GoogleHttpError(401)))).resolves.toBeUndefined();
  });
});
