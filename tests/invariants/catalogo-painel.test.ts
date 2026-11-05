import { describe, expect, it } from "vitest";

import { columnExists, sql } from "./gov-helpers";

const ORG = "fa299000-0000-4000-8000-000000000001";

describe("catálogo alimentado pelo painel", () => {
  it("instala a legenda do atendimento e a memória da URL original", () => {
    expect(columnExists("catalog_products", "legenda_atendimento")).toBe(true);
    expect(columnExists("catalog_products", "imagem_origem_url")).toBe(true);
  });

  it("guarda origem painel, legenda e URL sem misturar as duas URLs", () => {
    const resultado = sql(`
      insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'catalogo-painel-invariant', 'Catalogo Painel', 'Catalogo Painel')
      on conflict (id) do nothing;

      insert into public.catalog_products (
        organization_id, codigo, nome, descricao, preco_cents, origem,
        imagem_url, imagem_origem_url, legenda_atendimento
      ) values (
        '${ORG}', 'SUBLI-INVARIANTE', 'Produto do painel', 'Descrição', 12990, 'painel',
        'https://crm.example/storage/v1/object/public/catalog-media/${ORG}/produto/foto.jpg',
        'https://produtos.sublimando.com.br/f/foto.jpg',
        'Complemento do atendimento'
      )
      on conflict (organization_id, codigo) do update set
        origem=excluded.origem,
        imagem_url=excluded.imagem_url,
        imagem_origem_url=excluded.imagem_origem_url,
        legenda_atendimento=excluded.legenda_atendimento;

      select origem || '|' || imagem_origem_url || '|' || legenda_atendimento
      from public.catalog_products
      where organization_id='${ORG}' and codigo='SUBLI-INVARIANTE';
    `);

    expect(resultado.split("\n").at(-1)).toBe(
      "painel|https://produtos.sublimando.com.br/f/foto.jpg|Complemento do atendimento",
    );
  });
});
