import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../queue/queue";
import { criarFilaDeEnviosDoTurno } from "./fila-de-envios-do-turno";
import {
  executarCotacaoDeFrete,
  quoteShippingInputSchema,
  simularCotacaoDeFrete,
  type EstadoCotacaoFrete,
} from "./quote-shipping";

const ORG = "11111111-1111-4111-8111-111111111111";
const OUTRA_ORG = "99999999-9999-4999-8999-999999999999";
const TOKEN = "TOKEN-SENTINELA-NAO-PODE-VAZAR";

const configuracao = {
  base_url: "https://melhorenvio.com.br/api/v2",
  user_agent: "Loja Exemplo contato@example.test",
  origin_postal_code: "83320590",
  token_ciphertext: "cifrado",
  service_allowlist: [1, 2, 3, 4],
  declared_value_mode: "subtotal" as const,
  packaging_margin_cents: 100,
  local_postal_ranges: ["80000-83999"],
};
const produto = {
  codigo: "KIT-A",
  preco_cents: 10_000,
  peso_kg: "2.000",
  altura_cm: "10.0",
  largura_cm: "20.0",
  comprimento_cm: "30.0",
  embalagem_estimada: true,
};
type ProdutoTeste = Omit<typeof produto, "peso_kg"> & { peso_kg: string | null };
const opcoes = [
  {
    id: 1,
    nome: "PAC",
    empresa: "Correios",
    valor_cents: 3000,
    prazo_transporte_dias_uteis: 5,
    prazo_minimo_dias_uteis: 4,
    prazo_maximo_dias_uteis: 6,
  },
  {
    id: 2,
    nome: "SEDEX",
    empresa: "Correios",
    valor_cents: 5000,
    prazo_transporte_dias_uteis: 1,
    prazo_minimo_dias_uteis: 1,
    prazo_maximo_dias_uteis: 2,
  },
  {
    id: 3,
    nome: "Expresso",
    empresa: "Jadlog",
    valor_cents: 4000,
    prazo_transporte_dias_uteis: 3,
    prazo_minimo_dias_uteis: 2,
    prazo_maximo_dias_uteis: 4,
  },
  {
    id: 4,
    nome: "Normal",
    empresa: "Jadlog",
    valor_cents: 4500,
    prazo_transporte_dias_uteis: 4,
    prazo_minimo_dias_uteis: 3,
    prazo_maximo_dias_uteis: 5,
  },
];

function banco(args: { org?: string; produto?: ProdutoTeste } = {}): Queryable {
  const org = args.org ?? ORG;
  return {
    query: vi.fn(async (sql: string, valores?: unknown[]) => {
      if (sql.includes("from organization_shipping_settings")) {
        return { rows: valores?.[0] === org ? [configuracao] : [] };
      }
      if (sql.includes("from catalog_products")) {
        return { rows: valores?.[0] === org ? [args.produto ?? produto] : [] };
      }
      throw new Error(`consulta inesperada: ${sql}`);
    }),
  } as unknown as Queryable;
}

function base(overrides: Partial<Parameters<typeof executarCotacaoDeFrete>[0]> = {}) {
  return {
    db: banco(),
    organizationId: ORG,
    input: { cep: "80010-000", itens: [{ codigo: "KIT-A", quantidade: 2 }] },
    estado: { cotacoes: 0 } satisfies EstadoCotacaoFrete,
    decifrarToken: vi.fn(() => TOKEN),
    cotar: vi.fn(async () => opcoes),
    ...overrides,
  };
}

describe("crm_quote_shipping", () => {
  it("aceita só CEP, código e quantidade vindos do modelo", () => {
    expect(quoteShippingInputSchema.safeParse(base().input).success).toBe(true);
    expect(
      quoteShippingInputSchema.safeParse({
        cep: "80010000",
        itens: [{ codigo: "KIT-A", quantidade: 1, preco: 1 }],
      }).success,
    ).toBe(false);
    expect(
      quoteShippingInputSchema.safeParse({
        cep: "80010000",
        itens: [{ codigo: "KIT-A", quantidade: 0 }],
      }).success,
    ).toBe(false);
  });

  it("usa origem, preço, embalagem, serviços e margem somente do servidor", async () => {
    const args = base();
    const resultado = await executarCotacaoDeFrete(args);

    expect(args.cotar).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPostalCode: "83320590",
        toPostalCode: "80010000",
        package: { height: 20, width: 20, length: 30, weight: 4 },
        insuranceValue: 200,
        serviceAllowlist: [1, 2, 3, 4],
      }),
    );
    expect(resultado).toMatchObject({
      ok: true,
      simulada: false,
      retirada_ou_uber_disponivel: true,
      valor_de_referencia: true,
      embalagem_estimada: true,
      opcoes: [
        { servico: "PAC (Correios)", valor: "R$ 31,00", valor_cents: 3100 },
        { servico: "SEDEX (Correios)", valor: "R$ 51,00", valor_cents: 5100 },
        { servico: "Expresso (Jadlog)", valor: "R$ 41,00", valor_cents: 4100 },
      ],
    });
    expect(JSON.stringify(resultado)).not.toContain(TOKEN);
    expect(JSON.stringify(resultado)).not.toContain("metadata");
    expect(JSON.stringify(resultado)).not.toMatch(/confirme.*peso|pergunte.*peso/iu);
  });

  it("não consulta endereço da conta e sempre envia a origem da configuração", async () => {
    const cotar = vi.fn(async (entrada) => {
      expect(entrada.fromPostalCode).toBe(configuracao.origin_postal_code);
      expect(entrada).not.toHaveProperty("enderecos");
      return opcoes;
    });
    await executarCotacaoDeFrete(base({ cotar }));
    expect(cotar).toHaveBeenCalledOnce();
  });

  it("isola a organização e não cai para configuração nem produto vizinho", async () => {
    const db = banco({ org: ORG });
    const cotar = vi.fn(async () => opcoes);
    const resultado = await executarCotacaoDeFrete(
      base({ db, organizationId: OUTRA_ORG, cotar }),
    );
    expect(resultado).toMatchObject({ error: { code: "frete_nao_configurado" } });
    expect(cotar).not.toHaveBeenCalled();
    expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual([OUTRA_ORG]);
  });

  it("manda para pessoa quando falta peso ou medida", async () => {
    const db = banco({ produto: { ...produto, peso_kg: null } });
    const args = base({ db });
    await expect(executarCotacaoDeFrete(args)).resolves.toMatchObject({
      error: { code: "sem_peso_cadastrado" },
    });
    expect(args.cotar).not.toHaveBeenCalled();
  });

  it("não chama a API quando o pacote precisa de uma pessoa", async () => {
    const db = banco({ produto: { ...produto, peso_kg: "31.000" } });
    const args = base({
      db,
      input: { cep: "80010000", itens: [{ codigo: "KIT-A", quantidade: 1 }] },
    });
    await expect(executarCotacaoDeFrete(args)).resolves.toMatchObject({
      ok: true,
      simulada: false,
      precisa_pessoa: true,
    });
    expect(args.cotar).not.toHaveBeenCalled();
  });

  it("limita a duas chamadas reais por turno", async () => {
    const estado: EstadoCotacaoFrete = { cotacoes: 0 };
    const cotar = vi.fn(async () => opcoes);
    const args = base({ estado, cotar });
    await executarCotacaoDeFrete(args);
    await executarCotacaoDeFrete(args);
    await expect(executarCotacaoDeFrete(args)).resolves.toMatchObject({
      error: { code: "frete_limite_do_turno" },
    });
    expect(cotar).toHaveBeenCalledTimes(2);
    expect(estado.cotacoes).toBe(2);
  });

  it("simula sem configuração, token ou rede e repete o mesmo resultado", async () => {
    const db = banco();
    const primeira = await simularCotacaoDeFrete({
      db,
      organizationId: ORG,
      input: base().input,
      estado: { cotacoes: 0 },
    });
    const segunda = await simularCotacaoDeFrete({
      db,
      organizationId: ORG,
      input: base().input,
      estado: { cotacoes: 0 },
    });

    expect(primeira).toEqual(segunda);
    expect(primeira).toMatchObject({
      ok: true,
      simulada: true,
      retirada_ou_uber_disponivel: false,
      valor_de_referencia: true,
      opcoes: [
        expect.objectContaining({ servico: "Econômico (simulação)" }),
        expect.objectContaining({ servico: "Expresso (simulação)" }),
      ],
    });
    expect(vi.mocked(db.query).mock.calls).toHaveLength(2);
    for (const chamada of vi.mocked(db.query).mock.calls) {
      expect(chamada[0]).toContain("from catalog_products");
      expect(chamada[0]).not.toContain("organization_shipping_settings");
    }
  });

  it("respeita a mesma fila FIFO das falas do turno", async () => {
    const fila = criarFilaDeEnviosDoTurno();
    const ordem: string[] = [];
    let liberar!: () => void;
    let iniciou!: () => void;
    const espera = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const inicio = new Promise<void>((resolve) => {
      iniciou = resolve;
    });
    const cotacao = fila.enfileirar(() =>
      executarCotacaoDeFrete(
        base({
          cotar: vi.fn(async () => {
            ordem.push("cotação-início");
            iniciou();
            await espera;
            ordem.push("cotação-fim");
            return opcoes;
          }),
        }),
      ),
    );
    const fala = fila.enfileirar(async () => {
      ordem.push("fala");
      return "enviada";
    });
    await inicio;
    expect(ordem).toEqual(["cotação-início"]);
    liberar();
    await Promise.all([cotacao, fala]);
    expect(ordem).toEqual(["cotação-início", "cotação-fim", "fala"]);
  });
});
