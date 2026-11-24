/**
 * Fake mínimo do query builder do supabase-js, em memória — só o que
 * `tarefa-humana.ts`, `mover-etapa.ts` e o escalonamento do lembrete usam:
 * select/eq/is/in/gt/gte/lte/not/order/limit/maybeSingle/single/insert/update.
 * Índices únicos declarados por tabela devolvem `code: '23505'` como o Postgres.
 */
type Linha = Record<string, unknown>;

/** `tabela.coluna` lê dentro do objeto embutido (o `!inner` do PostgREST). */
function valor(l: Linha, c: string): unknown {
  if (!c.includes(".")) return l[c];
  const [rel, col] = c.split(".") as [string, string];
  const emb = l[rel] as Linha | Linha[] | undefined;
  const alvo = Array.isArray(emb) ? emb[0] : emb;
  return alvo?.[col];
}

export interface FakeSupabase {
  tabelas: Record<string, Linha[]>;
  from(tabela: string): unknown;
}

export function criarFakeSupabase(
  tabelas: Record<string, Linha[]>,
  unicos: Record<string, string[][]> = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dublê de teste: o builder é encadeável e dinâmico
): FakeSupabase & { from: (t: string) => any } {
  let seq = 0;
  const fake = {
    tabelas,
    from(tabela: string) {
      tabelas[tabela] ??= [];
      const filtros: Array<(l: Linha) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: Linha | Linha[] | null = null;
      let limite: number | null = null;
      let inicio = 0;
      const ordens: Array<{ col: string; asc: boolean; nullsFirst: boolean }> = [];
      const linhas = () => {
        let r = tabelas[tabela]!.filter((l) => filtros.every((f) => f(l)));
        if (ordens.length) {
          r = [...r].sort((a, b) => {
            for (const { col, asc, nullsFirst } of ordens) {
              const va = valor(a, col) ?? null;
              const vb = valor(b, col) ?? null;
              if (va === vb) continue;
              if (va === null) return nullsFirst ? -1 : 1;
              if (vb === null) return nullsFirst ? 1 : -1;
              return String(va).localeCompare(String(vb)) * (asc ? 1 : -1);
            }
            return 0;
          });
        }
        r = r.slice(inicio);
        return limite === null ? r : r.slice(0, limite);
      };
      const executar = (): { data: unknown; error: { code?: string; message: string } | null } => {
        if (op === "insert") {
          const novos = (Array.isArray(payload) ? payload : [payload!]).map((p): Linha => ({ id: `id-${++seq}`, ...p }));
          for (const novo of novos) {
            for (const cols of unicos[tabela] ?? []) {
              if (cols.some((c) => novo[c] === null || novo[c] === undefined)) continue;
              if (tabelas[tabela]!.some((l) => cols.every((c) => l[c] === novo[c]))) {
                return { data: null, error: { code: "23505", message: "duplicate key" } };
              }
            }
          }
          tabelas[tabela]!.push(...novos);
          return { data: novos.map((l) => ({ ...l })), error: null };
        }
        if (op === "update") {
          const alvo = linhas();
          for (const l of alvo) Object.assign(l, payload);
          return { data: alvo.map((l) => ({ ...l })), error: null };
        }
        // Cópias, como um banco de verdade: o que foi lido não muda sozinho
        // quando a linha muda depois.
        return { data: linhas().map((l) => ({ ...l })), error: null };
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem: imita o query builder do supabase-js
      const builder: any = {
        select: () => builder,
        insert: (p: Linha | Linha[]) => ((op = "insert"), (payload = p), builder),
        update: (p: Linha) => ((op = "update"), (payload = p), builder),
        eq: (c: string, v: unknown) => (filtros.push((l) => valor(l, c) === v), builder),
        neq: (c: string, v: unknown) => (filtros.push((l) => l[c] !== v), builder),
        is: (c: string, v: unknown) => (filtros.push((l) => (valor(l, c) ?? null) === v), builder),
        in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.includes(l[c])), builder),
        gt: (c: string, v: string) => (filtros.push((l) => String(l[c] ?? "") > v), builder),
        gte: (c: string, v: string) => (filtros.push((l) => String(l[c] ?? "") >= v), builder),
        lt: (c: string, v: string) => (filtros.push((l) => valor(l, c) != null && String(valor(l, c)) < v), builder),
        // Só o dialeto que o código usa: "a.eq.x,b.is.null,c.lt.<iso>".
        or: (expr: string) => {
          const ramos = expr.split(",").map((r) => {
            const [col, op, ...resto] = r.split(".");
            return { col: col!, op, v: resto.join(".") };
          });
          filtros.push((l) =>
            ramos.some((r) => {
              const v = valor(l, r.col);
              if (r.op === "eq") return String(v ?? "") === r.v;
              if (r.op === "is") return r.v === "null" ? (v ?? null) === null : false;
              if (r.op === "lt") return v != null && String(v) < r.v;
              return false;
            }),
          );
          return builder;
        },
        lte: (c: string, v: string) => (filtros.push((l) => l[c] != null && String(l[c]) <= v), builder),
        not: (c: string, _op: string, v: unknown) => (filtros.push((l) => (valor(l, c) ?? null) !== v), builder),
        // Como o Postgres: nulls por ÚLTIMO no ascendente, salvo `nullsFirst`.
        order: (col: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => (
          ordens.push({ col, asc: o?.ascending ?? true, nullsFirst: o?.nullsFirst ?? !(o?.ascending ?? true) }), builder
        ),
        range: (de: number, ate: number) => ((inicio = de), (limite = ate - de + 1), builder),
        limit: (n: number) => ((limite = n), builder),
        maybeSingle: async () => {
          const r = executar();
          if (r.error) return r;
          const arr = r.data as Linha[];
          return { data: arr[0] ?? null, error: null };
        },
        single: async () => {
          const r = executar();
          if (r.error) return r;
          const arr = r.data as Linha[];
          return arr[0] ? { data: arr[0], error: null } : { data: null, error: { message: "no rows" } };
        },
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(executar()).then(res, rej),
      };
      return builder;
    },
  };
  return fake;
}
