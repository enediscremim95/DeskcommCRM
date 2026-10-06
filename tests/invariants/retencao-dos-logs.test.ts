import { beforeEach, describe, expect, it } from "vitest";

import { lastLine, sql } from "./gov-helpers";

/**
 * A retenção dos dois logs que crescem sozinhos contra o Postgres real.
 *
 * Mock não prova o que importa aqui: o piso dentro do corpo, o predicado que
 * separa trabalho vivo de estado terminal, o lote e os privilégios efetivos.
 * Este arquivo roda sobre o mesmo baseline aplicado por uma instalação nova.
 */

const ORG = "28500000-0000-4000-8000-000000000001";

function id(n: number): string {
  return `28500000-1111-4000-8000-${String(n).padStart(12, "0")}`;
}

function conta(query: string): number {
  return Number(lastLine(sql(query)));
}

function arquivarWebhook(opts: { id: string; idadeDias: number; arquivado: boolean }): void {
  sql(`
    insert into webhook_events_log (
      id, organization_id, provider, raw_body, status, received_at, archived_at
    ) values (
      '${opts.id}', '${ORG}', 'generic',
      ${opts.arquivado ? "null" : "'corpo ainda presente'"},
      'processed',
      now() - interval '${opts.idadeDias} days',
      ${opts.arquivado ? "now() - interval '1 day'" : "null"}
    );
  `);
}

function emitirEvento(opts: {
  id: string;
  status: "pending" | "processing" | "done" | "dead";
  idadeDias: number;
  atualizadoHaDias?: number;
}): void {
  sql(`
    insert into event_log (
      id, organization_id, event_type, entity_kind, status, created_at, updated_at
    ) values (
      '${opts.id}', '${ORG}', 'retention.test', 'retention_test', '${opts.status}',
      now() - interval '${opts.idadeDias} days',
      now() - interval '${opts.atualizadoHaDias ?? opts.idadeDias} days'
    );
  `);
}

beforeEach(() => {
  sql(`
    insert into organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'org-retencao-285', 'Org Retenção 285 LTDA', 'Org Retenção 285')
      on conflict (id) do nothing;
    delete from webhook_events_log where organization_id = '${ORG}';
    delete from event_log where organization_id = '${ORG}';
  `);
});

describe("fn_expurgar_webhook_events_log_arquivado", () => {
  it("apaga somente linha arquivada e vencida", () => {
    arquivarWebhook({ id: id(1), idadeDias: 30, arquivado: true });
    arquivarWebhook({ id: id(2), idadeDias: 30, arquivado: false });
    arquivarWebhook({ id: id(3), idadeDias: 3, arquivado: true });

    expect(conta("select public.fn_expurgar_webhook_events_log_arquivado(14, 100)")).toBe(1);
    expect(
      conta(`select count(*) from webhook_events_log where id in ('${id(2)}', '${id(3)}')`),
    ).toBe(2);
  });

  it("o piso de 7 dias mora no corpo", () => {
    arquivarWebhook({ id: id(4), idadeDias: 3, arquivado: true });
    arquivarWebhook({ id: id(5), idadeDias: 20, arquivado: true });

    expect(conta("select public.fn_expurgar_webhook_events_log_arquivado(0, 100)")).toBe(1);
    expect(conta(`select count(*) from webhook_events_log where id = '${id(4)}'`)).toBe(1);
  });

  it("respeita o lote", () => {
    for (let i = 0; i < 5; i += 1) {
      arquivarWebhook({ id: id(10 + i), idadeDias: 30, arquivado: true });
    }

    expect(conta("select public.fn_expurgar_webhook_events_log_arquivado(14, 2)")).toBe(2);
    expect(conta(`select count(*) from webhook_events_log where organization_id = '${ORG}'`)).toBe(
      3,
    );
  });
});

describe("fn_expurgar_event_log_concluido", () => {
  it("apaga apenas done/dead velhos e preserva pending/processing", () => {
    emitirEvento({ id: id(20), status: "done", idadeDias: 60 });
    emitirEvento({ id: id(21), status: "dead", idadeDias: 60 });
    emitirEvento({ id: id(22), status: "pending", idadeDias: 60 });
    emitirEvento({ id: id(23), status: "processing", idadeDias: 60 });

    expect(conta("select public.fn_expurgar_event_log_concluido(30, 100)")).toBe(2);
    expect(
      lastLine(
        sql(
          `select string_agg(status, ',' order by status) from event_log where organization_id = '${ORG}'`,
        ),
      ),
    ).toBe("pending,processing");
  });

  it("usa updated_at: evento antigo que acabou de concluir permanece", () => {
    emitirEvento({ id: id(24), status: "done", idadeDias: 100, atualizadoHaDias: 1 });

    expect(conta("select public.fn_expurgar_event_log_concluido(30, 100)")).toBe(0);
    expect(conta(`select count(*) from event_log where id = '${id(24)}'`)).toBe(1);
  });

  it("o piso de 14 dias mora no corpo", () => {
    emitirEvento({ id: id(25), status: "done", idadeDias: 10 });
    emitirEvento({ id: id(26), status: "done", idadeDias: 20 });

    expect(conta("select public.fn_expurgar_event_log_concluido(0, 100)")).toBe(1);
    expect(conta(`select count(*) from event_log where id = '${id(25)}'`)).toBe(1);
  });

  it("respeita o lote", () => {
    for (let i = 0; i < 5; i += 1) {
      emitirEvento({ id: id(30 + i), status: "dead", idadeDias: 60 });
    }

    expect(conta("select public.fn_expurgar_event_log_concluido(30, 2)")).toBe(2);
    expect(conta(`select count(*) from event_log where organization_id = '${ORG}'`)).toBe(3);
  });
});

describe("EXECUTE das duas funções de retenção", () => {
  const funcoes = [
    "fn_expurgar_webhook_events_log_arquivado",
    "fn_expurgar_event_log_concluido",
  ] as const;

  it("anon e authenticated não executam", () => {
    for (const fn of funcoes) {
      for (const papel of ["anon", "authenticated"]) {
        expect(
          lastLine(
            sql(`select has_function_privilege('${papel}', 'public.${fn}(int,int)', 'EXECUTE')`),
          ),
          `${papel} pode executar ${fn}`,
        ).toBe("f");
      }
    }
  });

  it("service_role executa", () => {
    for (const fn of funcoes) {
      expect(
        lastLine(
          sql(`select has_function_privilege('service_role', 'public.${fn}(int,int)', 'EXECUTE')`),
        ),
        `service_role não pode executar ${fn}`,
      ).toBe("t");
    }
  });
});
