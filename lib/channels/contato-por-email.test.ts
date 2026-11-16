import { describe, expect, it } from "vitest";
import { encontrarOuCriarContatoPorTelefone } from "./contato-por-telefone";

type Chamada = [string, ...unknown[]];

/** Banco falso: telefone não acha ninguém; e-mail acha o contato da organização. */
function admin(porEmail: { id: string; phone_number: string | null; name: string } | null) {
  const chamadas: Chamada[] = [];
  const consulta = (tabela: string, acabaEmEmail: boolean) => {
    const c: Record<string, unknown> = new Proxy({}, {
      get: (_, k) => {
        if (k === "then") return undefined;
        if (k === "maybeSingle") return async () => ({ data: acabaEmEmail ? porEmail : null, error: null });
        return (...a: unknown[]) => {
          chamadas.push([`${tabela}.${String(k)}`, ...a]);
          if (k === "eq" && a[0] === "email_normalized") return consultaEmail(tabela);
          return c;
        };
      },
    });
    return c;
  };
  const consultaEmail = (tabela: string) => consulta(tabela, true);
  const client = { from: (t: string) => consulta(t, false) } as never;
  return { client, chamadas };
}

describe("formulário sem WhatsApp: reencontro por e-mail", () => {
  const base = { organizationId: "org-qualquer", name: "Ana", source: "webhook" };

  it("reusa o contato do mesmo e-mail (normalizado) em vez de inserir outro", async () => {
    const { client, chamadas } = admin({ id: "c1", phone_number: null, name: "Ana" });
    const r = await encontrarOuCriarContatoPorTelefone(client, { ...base, phone: null, email: "  Ana@Exemplo.COM " });
    expect(r).toMatchObject({ criado: false, contato: { id: "c1" } });
    expect(chamadas).toContainEqual(["contacts.eq", "email_normalized", "ana@exemplo.com"]);
    expect(chamadas).toContainEqual(["contacts.eq", "organization_id", "org-qualquer"]);
    expect(chamadas.some(([k]) => k === "contacts.insert")).toBe(false);
  });

  it("sem telefone e sem e-mail conhecido, cria o contato", async () => {
    const { client, chamadas } = admin(null);
    await encontrarOuCriarContatoPorTelefone(client, { ...base, phone: null, email: "novo@exemplo.com" });
    expect(chamadas.some(([k]) => k === "contacts.insert")).toBe(true);
  });
});
