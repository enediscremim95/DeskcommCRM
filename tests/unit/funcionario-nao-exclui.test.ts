import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  replacementRemovesValues,
  roleHasPermission,
  userHasPermission,
} from "@/lib/auth/permissions";

const ROOT = process.cwd();

function arquivosDeRota(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return arquivosDeRota(path);
    return entry.isFile() && entry.name === "route.ts" ? [path] : [];
  });
}

function caminho(file: string): string {
  return relative(ROOT, file).replaceAll("\\", "/");
}

function corpoDoDelete(source: ts.SourceFile): ts.Node | null {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "DELETE") {
      return statement.body ?? null;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "DELETE") continue;
      if (
        declaration.initializer &&
        (ts.isArrowFunction(declaration.initializer) ||
          ts.isFunctionExpression(declaration.initializer))
      ) {
        return declaration.initializer.body;
      }
    }
  }
  return null;
}

function pisoHumanoBaixo(body: ts.Node): "viewer" | "agent" | null {
  let found: "viewer" | "agent" | null = null;
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "requireRole" &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0]) &&
      (node.arguments[0].text === "viewer" || node.arguments[0].text === "agent")
    ) {
      found = node.arguments[0].text;
    }
    ts.forEachChild(node, visit);
  }
  visit(body);
  return found;
}

describe("Atendente não exclui recursos", () => {
  it("a permissão central recusa agent e libera manager/admin", () => {
    expect(roleHasPermission("viewer", "resource.delete")).toBe(false);
    expect(roleHasPermission("agent", "resource.delete")).toBe(false);
    expect(roleHasPermission("ai_operator", "resource.delete")).toBe(false);
    expect(roleHasPermission("manager", "resource.delete")).toBe(true);
    expect(roleHasPermission("admin", "resource.delete")).toBe(true);
  });

  it("lead.delete libera gerente e plataforma, mas recusa administrador da organização", () => {
    expect(roleHasPermission("manager", "lead.delete")).toBe(true);
    expect(roleHasPermission("admin", "lead.delete")).toBe(false);
    expect(
      userHasPermission(
        { is_platform_admin: true, support: null },
        { role: "viewer" },
        "lead.delete",
      ),
    ).toBe(true);
  });

  it("ai.credentials.delete libera administrador da organização e plataforma, mas recusa gerente", () => {
    expect(roleHasPermission("manager", "ai.credentials.delete")).toBe(false);
    expect(roleHasPermission("admin", "ai.credentials.delete")).toBe(true);
    expect(
      userHasPermission(
        { is_platform_admin: true, support: null },
        { role: "viewer" },
        "ai.credentials.delete",
      ),
    ).toBe(true);
  });

  it("reconhece remoção escondida na substituição de etiquetas", () => {
    expect(replacementRemovesValues(["quente", "retorno"], ["quente"])).toBe(true);
    expect(replacementRemovesValues(["quente"], ["quente", "novo"])).toBe(false);
  });

  it("nenhum DELETE novo nasce com piso de atendente sem uma isenção operacional explícita", () => {
    const isencoes = new Map([
      [
        "app/api/v1/conversations/[id]/snooze/route.ts",
        "cancela somente o lembrete temporário da conversa",
      ],
      ["app/api/v1/notifications/push/route.ts", "remove a assinatura push do próprio navegador"],
      ["app/api/v1/voice/calls/[id]/route.ts", "encerra a própria chamada ativa"],
    ]);

    const encontrados = new Map<string, string>();
    for (const file of arquivosDeRota(join(ROOT, "app", "api"))) {
      const source = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const body = corpoDoDelete(source);
      if (!body) continue;
      const role = pisoHumanoBaixo(body);
      if (role) encontrados.set(caminho(file), role);
    }

    expect([...encontrados.keys()].sort()).toEqual([...isencoes.keys()].sort());
    expect([...isencoes.values()].every((motivo) => motivo.length > 20)).toBe(true);
  });

  it("a exclusão de lead por POST também passa pelo gate antes do efeito", () => {
    const source = readFileSync(join(ROOT, "app/api/v1/leads/bulk/route.ts"), "utf8");
    const gate = source.indexOf('requirePermission("lead.delete"');
    const efeito = source.indexOf('case "delete"');
    expect(gate).toBeGreaterThan(-1);
    expect(efeito).toBeGreaterThan(gate);
    expect(source).toContain('input.action === "tag" && (input.params.remove?.length ?? 0) > 0');
  });

  it("a rota de exclusão de credencial usa a capacidade nomeada antes do efeito", () => {
    const source = readFileSync(join(ROOT, "app/api/v1/ai/credentials/[id]/route.ts"), "utf8");
    const gate = source.indexOf('requirePermission("ai.credentials.delete"');
    const efeito = source.indexOf('.from("ai_provider_credentials")\n    .delete()');
    expect(gate).toBeGreaterThan(-1);
    expect(efeito).toBeGreaterThan(gate);
  });

  it("substituições de etiquetas exigem o gate quando removem valores", () => {
    for (const file of [
      "app/api/v1/contacts/[id]/route.ts",
      "app/api/v1/conversations/[id]/route.ts",
    ]) {
      const source = readFileSync(join(ROOT, file), "utf8");
      expect(source, file).toContain("replacementRemovesValues(previous, input.tags)");
      expect(source, file).toContain('requirePermission("resource.delete"');
    }
  });

  it("as telas operacionais consultam a mesma permissão para esconder exclusões", () => {
    const leadFiles = [
      "components/kanban/BulkActionBar.tsx",
      "components/kanban/KanbanCardActions.tsx",
      "components/leads/LeadPageClient.tsx",
    ];
    for (const file of leadFiles) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(
        'usePermission("lead.delete")',
      );
    }
    const resourceFiles = [
      "components/contacts/ContactsTable.tsx",
      "components/inbox/ChatThread.tsx",
      "components/inbox/ContactTagsEditor.tsx",
      "components/inbox/ConversationTagsEditor.tsx",
      "components/contacts/EditContactDialog.tsx",
      "components/agenda/DetalheDoCompromisso.tsx",
      "app/app/agenda/_components/CartaoDaConexaoGoogle.tsx",
      "app/app/tasks/_components/TarefasClient.tsx",
      "app/app/templates/_components/TemplatesClient.tsx",
    ];
    for (const file of resourceFiles) {
      expect(readFileSync(join(ROOT, file), "utf8"), file).toContain(
        'usePermission("resource.delete")',
      );
    }
  });
});
