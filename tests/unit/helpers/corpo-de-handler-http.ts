/**
 * Localiza o corpo de um handler HTTP exportado numa `route.ts`.
 *
 * A varredura precisa enxergar as duas formas do App Router:
 * `export async function POST(…)` e `export const POST = …`. Nesta segunda,
 * o inicializador pode ser a função em si ou um wrapper
 * (`comAuthDisponivel(POSTComAuth)`, `comAuthDisponivel(async () => …)` e
 * equivalentes). O gate mede o CORPO do handler, não a linha do wrapper —
 * estar envolvido por `comAuthDisponivel` não substitui
 * `requirePermission` / `requireSupportWrite` / `requireRole`.
 *
 * Identificador no mesmo arquivo é seguido. Import ou indireção opaca
 * devolve `null` (falhar fechado): o teste acusa a rota em vez de assumir
 * que a guarda existe onde a varredura não vê.
 */
import ts from "typescript";

export function corpoDoHandlerExportado(
  source: ts.SourceFile,
  nome: string,
): ts.Node | null {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === nome) {
      return statement.body ?? null;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== nome) {
        continue;
      }
      if (!declaration.initializer) return null;
      return desembulhar(source, declaration.initializer, new Set());
    }
  }
  return null;
}

function desembulhar(
  source: ts.SourceFile,
  expr: ts.Expression,
  vistos: Set<string>,
): ts.Node | null {
  while (ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }

  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return expr.body;
  }

  if (ts.isCallExpression(expr)) {
    for (const arg of expr.arguments) {
      const corpo = desembulhar(source, arg, vistos);
      if (corpo) return corpo;
    }
    return null;
  }

  if (ts.isIdentifier(expr)) {
    if (vistos.has(expr.text)) return null;
    vistos.add(expr.text);
    return resolverNoArquivo(source, expr.text, vistos);
  }

  return null;
}

function resolverNoArquivo(
  source: ts.SourceFile,
  nome: string,
  vistos: Set<string>,
): ts.Node | null {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === nome) {
      return statement.body ?? null;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== nome) {
        continue;
      }
      if (!declaration.initializer) return null;
      return desembulhar(source, declaration.initializer, vistos);
    }
  }
  return null;
}
