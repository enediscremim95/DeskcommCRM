/**
 * Localiza o corpo de um handler HTTP exportado numa `route.ts`.
 *
 * A varredura precisa enxergar as duas formas do App Router:
 * `export async function POST(…)` e `export const POST = …`. Nesta segunda,
 * o inicializador pode ser uma função, um identificador local ou o wrapper
 * conhecido (`comAuthDisponivel(POSTComAuth)` ou
 * `comAuthDisponivel(async () => …)`). O gate mede o CORPO do handler —
 * estar envolvido por `comAuthDisponivel` não substitui
 * `requirePermission` / `requireSupportWrite` / `requireRole`.
 *
 * Identificador no mesmo arquivo é seguido. Import ou indireção opaca
 * devolve `null`; chamada desconhecida ou ambígua lança erro explícito.
 * Assim o teste acusa a rota (falhar fechado) em vez de assumir
 * que a guarda existe onde a varredura não vê.
 */
import ts from "typescript";

// Lista conferida nos exports HTTP de app/api/**/route.ts. Este é o único
// wrapper encontrado e seu contrato recebe exatamente um handler.
const WRAPPERS_DE_HANDLER = new Set(["comAuthDisponivel"]);

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
    if (
      !ts.isIdentifier(expr.expression) ||
      !WRAPPERS_DE_HANDLER.has(expr.expression.text)
    ) {
      throw new Error(
        `Não é possível medir o handler: chamada de wrapper desconhecido (${expr.expression.getText(source)}).`,
      );
    }
    // Não procuramos o primeiro argumento resolvível: outro argumento pode
    // ser o handler verdadeiro, inclusive importado e invisível à varredura.
    const argumento = expr.arguments[0];
    if (
      argumento === undefined ||
      expr.arguments.length !== 1 ||
      ts.isSpreadElement(argumento)
    ) {
      throw new Error(
        `Não é possível medir o handler: wrapper ${expr.expression.text} exige um único argumento handler, sem ambiguidade.`,
      );
    }
    return desembulhar(source, argumento, vistos);
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
