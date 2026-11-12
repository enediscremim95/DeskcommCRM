/**
 * Localiza o corpo de um handler HTTP exportado numa `route.ts`.
 *
 * A varredura precisa enxergar as duas formas do App Router:
 * `export async function POST(…)` e `export const POST = …`. Nesta segunda,
 * o inicializador pode ser uma função, um identificador local ou o wrapper
 * conhecido (`comAuthDisponivel(POSTComAuth)` ou
 * `comAuthDisponivel(async () => …)`), somente quando o nome (ou um alias)
 * vem do import de `@/lib/auth/api-disponivel`. O gate mede o CORPO do
 * handler — estar envolvido por `comAuthDisponivel` não substitui
 * `requirePermission` / `requireSupportWrite` / `requireRole`.
 *
 * Identificador no mesmo arquivo é seguido. Import ou indireção opaca
 * devolve `null`; chamada desconhecida, redefinição local, origem errada
 * ou ambígua lança erro explícito. Assim o teste acusa a rota (falhar
 * fechado) em vez de assumir que a guarda existe onde a varredura não vê.
 */
import ts from "typescript";

const MODULO_COM_AUTH_DISPONIVEL = "@/lib/auth/api-disponivel";
const WRAPPER_COM_AUTH_DISPONIVEL = "comAuthDisponivel";

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
    if (!ts.isIdentifier(expr.expression)) {
      throw new Error(
        `Não é possível medir o handler: chamada de wrapper desconhecido (${expr.expression.getText(source)}).`,
      );
    }
    const nomeLocal = expr.expression.text;
    const ligacao = ligacaoDeImportacao(source, nomeLocal);
    const pretendeSerWrapper =
      nomeLocal === WRAPPER_COM_AUTH_DISPONIVEL ||
      ligacao?.nomeImportado === WRAPPER_COM_AUTH_DISPONIVEL;
    if (!pretendeSerWrapper) {
      throw new Error(
        `Não é possível medir o handler: chamada de wrapper desconhecido (${nomeLocal}).`,
      );
    }
    if (temDeclaracaoLocal(source, nomeLocal)) {
      throw new Error(
        `Não é possível medir o handler: ${WRAPPER_COM_AUTH_DISPONIVEL} foi redefinido neste arquivo; só é aceito o import de ${MODULO_COM_AUTH_DISPONIVEL}.`,
      );
    }
    if (
      !ligacao ||
      ligacao.modulo !== MODULO_COM_AUTH_DISPONIVEL ||
      ligacao.nomeImportado !== WRAPPER_COM_AUTH_DISPONIVEL
    ) {
      const origem = ligacao ? ligacao.modulo : "nenhum import";
      throw new Error(
        `Não é possível medir o handler: ${WRAPPER_COM_AUTH_DISPONIVEL} não veio de ${MODULO_COM_AUTH_DISPONIVEL} (origem: ${origem}).`,
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
        `Não é possível medir o handler: wrapper ${nomeLocal} exige um único argumento handler, sem ambiguidade.`,
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

function ligacaoDeImportacao(
  source: ts.SourceFile,
  nomeLocal: string,
): { modulo: string; nomeImportado: string } | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const modulo = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.name && clause.name.text === nomeLocal) {
      return { modulo, nomeImportado: "default" };
    }
    const bindings = clause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings) && bindings.name.text === nomeLocal) {
      return { modulo, nomeImportado: "*" };
    }
    if (ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (element.name.text !== nomeLocal) continue;
        const nomeImportado = element.propertyName
          ? element.propertyName.text
          : element.name.text;
        return { modulo, nomeImportado };
      }
    }
  }
  return undefined;
}

function temDeclaracaoLocal(source: ts.SourceFile, nome: string): boolean {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === nome) {
      return true;
    }
    if (ts.isClassDeclaration(statement) && statement.name?.text === nome) {
      return true;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === nome) {
        return true;
      }
    }
  }
  return false;
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
