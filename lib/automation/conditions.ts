/**
 * Condições do motor de regras: filtros simples
 * (eq/neq/contains/not_contains) em AND.
 * Campo ausente é falso para eq/contains e verdadeiro para
 * neq/not_contains (nunca erro). Coerção via String() dos dois lados; o value
 * vem sempre como string da UI.
 */
export type ConditionOp = "eq" | "neq" | "contains" | "not_contains";

export interface RuleCondition {
  field: string;
  op: ConditionOp;
  value: string;
}

export function resolveField(context: Record<string, unknown>, path: string): unknown {
  let cur: unknown = context;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function normalizeForContains(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function matches(cond: RuleCondition, context: Record<string, unknown>): boolean {
  const raw = resolveField(context, cond.field);
  if (raw === undefined || raw === null) {
    return cond.op === "neq" || cond.op === "not_contains";
  }
  if (cond.op === "contains" || cond.op === "not_contains") {
    const contains = Array.isArray(raw)
      ? raw.map(String).includes(cond.value)
      : normalizeForContains(String(raw)).includes(normalizeForContains(cond.value));
    return cond.op === "contains" ? contains : !contains;
  }
  const equal = String(raw) === cond.value;
  return cond.op === "eq" ? equal : !equal;
}

export function evaluateConditions(
  conditions: RuleCondition[],
  context: Record<string, unknown>,
): boolean {
  return conditions.every((c) => matches(c, context));
}
