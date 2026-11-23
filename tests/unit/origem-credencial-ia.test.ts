import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261123120000_0314_origem_credencial_ia.sql",
  "utf8",
);

describe("origem da credencial de IA", () => {
  it("classifica o legado pelo fornecedor e rótulo na introdução da coluna", () => {
    expect(migration).toMatch(/if not exists[\s\S]*add column origem text not null default 'propria'/);
    expect(migration).toMatch(/check \(origem in \('propria', 'compartilhada'\)\)/);
    expect(migration).toMatch(
      /set origem = 'compartilhada'\s+where provider = 'openrouter'\s+and label = 'CRM V4 Flash lock 17-11';\s+end if;/,
    );
  });

  it("publica a origem na view com RLS e leva a migration ao self-host", () => {
    expect(migration).toContain("with (security_invoker = true)");
    expect(migration).toContain("grant select (origem)");
    expect(migration).not.toMatch(/api_key_(encrypted|iv|tag)\b/);
    expect(readFileSync("supabase/baseline.sql", "utf8")).toContain(migration);
  });
});
