import ts from "typescript";
import { describe, expect, it } from "vitest";
import { corpoDoHandlerExportado } from "./corpo-de-handler-http";

function medir(codigo: string, nome = "POST") {
  const source = ts.createSourceFile(
    "route.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
  );
  return corpoDoHandlerExportado(source, nome)?.getText(source) ?? null;
}

describe("corpo do handler HTTP exportado", () => {
  it("recusa fábrica desconhecida sem medir o auxiliar com guarda", () => {
    expect(() => medir(`
      import { handlerImportado } from "./handler";
      function auxiliarComGuarda() { requireSupportWrite(); }
      export const POST = fabrica(handlerImportado, auxiliarComGuarda);
    `)).toThrow(/wrapper desconhecido \(fabrica\)/);
  });

  it("mede o corpo do handler local dentro de comAuthDisponivel", () => {
    expect(medir(`
      function handler() { requireSupportWrite(); }
      export const POST = comAuthDisponivel(handler);
    `)).toBe("{ requireSupportWrite(); }");
  });

  it("recusa wrapper conhecido com dois candidatos a handler", () => {
    expect(() => medir(`
      function handler() { efeito(); }
      function auxiliarComGuarda() { requireSupportWrite(); }
      export const POST = comAuthDisponivel(handler, auxiliarComGuarda);
    `)).toThrow(/exige um único argumento handler, sem ambiguidade/);
  });

  it("recusa argumento opaco junto de auxiliar resolvível mesmo no wrapper conhecido", () => {
    expect(() => medir(`
      import { handlerImportado } from "./handler";
      const auxiliarComGuarda = () => { requireSupportWrite(); };
      export const POST = comAuthDisponivel(handlerImportado, auxiliarComGuarda);
    `)).toThrow(/sem ambiguidade/);
  });

  it("resolve identificador local exportado como GET", () => {
    expect(medir(`
      const handle = () => { requireRole(); };
      export const GET = handle;
    `, "GET")).toBe("{ requireRole(); }");
  });

  it.each([
    "export function POST() { efeito(); }",
    "export const POST = function () { efeito(); };",
    "export const POST = () => { efeito(); };",
    "export const POST = comAuthDisponivel(() => { efeito(); });",
  ])("mede funções diretas: %s", (codigo) => {
    expect(medir(codigo)).toBe("{ efeito(); }");
  });

  it.each([
    'import { handler } from "./handler"; export const POST = handler;',
    'import { handler } from "./handler"; export const POST = comAuthDisponivel(handler);',
    "const a = b; const b = a; export const POST = a;",
    "export const POST = condicao ? primeiro : segundo;",
  ])("falha fechado para import ou indireção opaca: %s", (codigo) => {
    expect(medir(codigo)).toBeNull();
  });

  it.each([
    "export const POST = comAuthDisponivel();",
    "export const POST = comAuthDisponivel(...handlers);",
  ])("recusa ausência ou quantidade opaca de handlers: %s", (codigo) => {
    expect(() => medir(codigo)).toThrow(/sem ambiguidade/);
  });
});
