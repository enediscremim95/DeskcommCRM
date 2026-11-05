import { beforeAll, describe, expect, it } from "vitest";
import { countAs, sql, writeCountAs } from "./gov-helpers";

const ORG_A = "fa300000-0000-4000-8000-00000000000a";
const ORG_B = "fa300000-0000-4000-8000-00000000000b";
const AGENT_A = "fa300000-1111-4000-8000-00000000000a";
const MANAGER_A = "fa300000-1111-4000-8000-00000000000b";

beforeAll(() => {
  sql(`
    insert into auth.users (id,email) values
      ('${AGENT_A}','galeria-agent-a@invariant.test'),
      ('${MANAGER_A}','galeria-manager-a@invariant.test')
    on conflict (id) do nothing;
    insert into public.organizations (id,slug,legal_name,display_name) values
      ('${ORG_A}','galeria-a','Galeria A','Galeria A'),
      ('${ORG_B}','galeria-b','Galeria B','Galeria B')
    on conflict (id) do nothing;
    insert into public.user_organizations (user_id,organization_id,role,accepted_at) values
      ('${AGENT_A}','${ORG_A}','agent',now()),
      ('${MANAGER_A}','${ORG_A}','manager',now())
    on conflict do nothing;
    insert into public.catalog_product_groups (organization_id,produto_codigo,nome) values
      ('${ORG_A}','MESMO-SKU','Produto A'),
      ('${ORG_B}','MESMO-SKU','Produto B')
    on conflict (organization_id,produto_codigo) do nothing;
    insert into public.catalog_products (organization_id,codigo,nome,preco_cents,produto_codigo,origem) values
      ('${ORG_A}','MESMO-CODIGO','Produto A',1000,'MESMO-SKU','painel'),
      ('${ORG_B}','MESMO-CODIGO','Produto B',999900,'MESMO-SKU','painel')
    on conflict (organization_id,codigo) do update set produto_codigo=excluded.produto_codigo;
    insert into public.catalog_product_images (
      organization_id,produto_codigo,posicao,storage_path,mime_type,size_bytes,source_hash,imagem_origem_url
    ) values
      ('${ORG_A}','MESMO-SKU',1,'${ORG_A}/MESMO-SKU/a.jpg','image/jpeg',10,'hash-a','https://orgbling.s3.amazonaws.com/a?h=hash-a'),
      ('${ORG_B}','MESMO-SKU',1,'${ORG_B}/MESMO-SKU/b.jpg','image/jpeg',10,'hash-b','https://orgbling.s3.amazonaws.com/b?h=hash-b')
    on conflict (organization_id,produto_codigo,posicao) do nothing;
  `);
});

describe("galeria e lookup da tool isolados por organização", () => {
  it("o agente lê somente a foto e a linha de preço da própria organização", () => {
    expect(
      countAs(AGENT_A, `select count(*) from public.catalog_product_images where produto_codigo='MESMO-SKU';`),
    ).toBe(1);
    expect(
      countAs(AGENT_A, `select count(*) from public.catalog_products where codigo='MESMO-CODIGO';`),
    ).toBe(1);
  });

  it("o gerente da organização A não grava foto no pai da organização B", () => {
    expect(
      writeCountAs(
        MANAGER_A,
        `insert into public.catalog_product_images (
          organization_id,produto_codigo,posicao,storage_path,mime_type,size_bytes,source_hash,imagem_origem_url
        ) values ('${ORG_B}','MESMO-SKU',2,'${ORG_B}/MESMO-SKU/forjada.jpg','image/jpeg',10,'forjada','https://orgbling.s3.amazonaws.com/x?h=forjada')`,
      ),
    ).toBe(0);
  });

  it("a função atômica da galeria não é executável por authenticated", () => {
    expect(
      sql(`select has_function_privilege('authenticated','public.fn_sync_catalog_product_images(uuid,text,jsonb)','EXECUTE');`),
    ).toBe("f");
  });
});
