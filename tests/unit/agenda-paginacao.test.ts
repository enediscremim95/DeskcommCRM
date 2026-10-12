import { expect, it, vi } from "vitest";
import { protecaoAgendaPg, protecaoAgendaSupabase } from "@/lib/agenda/protecao-followup";
import { assertAgendaEffectSupabase } from "@/lib/agenda/efeito";
import { logger } from "@/lib/logger";
const now = new Date("2026-09-06T12:00:00Z");
it("páginas truncadas abaixo do limit são lidas até vazio; protetor após 1000 coincide com PG e barra efeito", async () => {
  const rows = Array.from({ length: 1101 }, (_, n) => ({
    id: String(n).padStart(5, "0"),
    contact_id: "contact",
    revision: 1,
    status: "confirmed",
    starts_at: n === 1100 ? "2099-01-01T12:00:00Z" : "2020-01-01T12:00:00Z",
    ends_at: n === 1100 ? "2099-01-01T13:00:00Z" : "2020-01-01T13:00:00Z",
  }));
  const cursors: string[] = [];
  const db = {
    from: (table: string) => {
      let cursor = "";
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        limit: () => q,
        gt: (_key: string, value: string) => {
          cursor = value;
          return q;
        },
        single: async () => ({ data: { settings: {} }, error: null }),
        then: (resolve: (value: unknown) => unknown) => {
          cursors.push(cursor);
          return Promise.resolve({
            data:
              table === "calendar_appointments"
                ? rows.filter((r) => r.id > cursor).slice(0, 127)
                : [],
            error: null,
          }).then(resolve);
        },
      };
      return q;
    },
  };
  const a = (await protecaoAgendaSupabase(db as never, "org", ["contact"], now)).get("contact");
  const pg = {
    query: async (sql: string) => ({
      rows: sql.includes("calendar_appointments") ? rows : [{ settings: {} }],
    }),
  };
  expect(a).toEqual(await protecaoAgendaPg(pg as never, "org", "contact", now));
  expect(a).toMatchObject({ adiar: true, appointment_id: "01100" });
  expect(cursors.at(-1)).toBe("01100");
  await expect(
    assertAgendaEffectSupabase(db as never, { organizationId: "org", contactId: "contact" }),
  ).rejects.toMatchObject({ protection: { adiar: true, appointment_id: "01100" } });
});
it("falha de página posterior não transforma leitura parcial em ausência", async () => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  let second = false;
  const q = {
    select: () => q,
    eq: () => q,
    in: () => q,
    order: () => q,
    limit: () => q,
    gt: () => {
      second = true;
      return q;
    },
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(
        second
          ? { data: null, error: { message: "page unavailable" } }
          : { data: [{ id: "1", contact_id: "c" }], error: null },
      ).then(resolve),
  };
  expect(
    (await protecaoAgendaSupabase({ from: () => q } as never, "org", ["c"], now)).get("c"),
  ).toMatchObject({ adiar: true, motivo: "leitura_indisponivel" });
  expect(warn).toHaveBeenCalledOnce();
  warn.mockRestore();
});

it("divide 2.500 contatos em lotes de 100 e reúne compromisso do terceiro lote", async () => {
  const contatos = Array.from({ length: 2_500 }, (_, index) => `contact-${index}`);
  const contatoComCompromisso = contatos[250]!;
  const lotes: string[][] = [];
  const compromisso = {
    id: "appointment-third-batch",
    contact_id: contatoComCompromisso,
    revision: 1,
    status: "pending",
    starts_at: "2099-01-01T12:00:00Z",
    ends_at: "2099-01-01T13:00:00Z",
  };
  const db = {
    from: (table: string) => {
      let contatosDoLote: string[] = [];
      let cursor = "";
      const q = {
        select: () => q,
        eq: () => q,
        in: (coluna: string, valores: string[]) => {
          if (coluna === "contact_id") {
            contatosDoLote = valores;
            lotes.push([...valores]);
          }
          return q;
        },
        order: () => q,
        limit: () => q,
        gt: (_coluna: string, valor: string) => {
          cursor = valor;
          return q;
        },
        single: async () => ({ data: { settings: {} }, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({
            data:
              table === "calendar_appointments" &&
              contatosDoLote.includes(contatoComCompromisso) &&
              !cursor
                ? [compromisso]
                : [],
            error: null,
          }).then(resolve),
      };
      return q;
    },
  };

  const protecoes = await protecaoAgendaSupabase(db as never, "org", contatos, now);

  expect(Math.max(...lotes.map((lote) => lote.length))).toBe(100);
  expect(protecoes.size).toBe(2_500);
  expect(protecoes.get(contatoComCompromisso)).toMatchObject({
    adiar: true,
    motivo: "agendado",
    appointment_id: compromisso.id,
  });
  expect(protecoes.get(contatos[0]!)).toMatchObject({
    adiar: false,
    motivo: "sem_compromisso",
  });
});

it("falha em um dos 25 lotes torna todos os 2.500 contatos indisponíveis", async () => {
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  const contatos = Array.from({ length: 2_500 }, (_, index) => `contact-${index}`);
  const db = {
    from: () => {
      let contatosDoLote: string[] = [];
      const q = {
        select: () => q,
        eq: () => q,
        in: (coluna: string, valores: string[]) => {
          if (coluna === "contact_id") contatosDoLote = valores;
          return q;
        },
        order: () => q,
        limit: () => q,
        gt: () => q,
        single: async () => ({ data: { settings: {} }, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            contatosDoLote.includes("contact-200")
              ? { data: null, error: { message: "gateway recusou a URL" } }
              : { data: [], error: null },
          ).then(resolve),
      };
      return q;
    },
  };

  const protecoes = await protecaoAgendaSupabase(db as never, "org", contatos, now);

  expect(protecoes.size).toBe(2_500);
  expect([...protecoes.values()].every((p) => p.motivo === "leitura_indisponivel")).toBe(true);
  expect(warn).toHaveBeenCalledTimes(2_500);
  warn.mockRestore();
});
