export type Condition = string | { all: Condition[] } | { any: Condition[] } | { not: Condition };

/** Each fact prefix names one record kind. `flag` facts name no record. */
export const FACT_KINDS = {
  solved: 'puzzles',
  acquired: 'transmissions',
  read: 'archives',
  discovered: 'sectors',
  completed: 'episodes',
  flag: null,
} as const;

export type FactPrefix = keyof typeof FACT_KINDS;

export function evaluate(condition: Condition | undefined, facts: ReadonlySet<string>): boolean {
  if (condition === undefined) return true;
  if (typeof condition === 'string') return facts.has(condition);
  if ('all' in condition) return condition.all.every((c) => evaluate(c, facts));
  if ('any' in condition) return condition.any.some((c) => evaluate(c, facts));
  return !evaluate(condition.not, facts);
}

export function factsIn(condition: Condition | undefined): string[] {
  if (condition === undefined) return [];
  if (typeof condition === 'string') return [condition];
  if ('all' in condition) return condition.all.flatMap(factsIn);
  if ('any' in condition) return condition.any.flatMap(factsIn);
  return factsIn(condition.not);
}
