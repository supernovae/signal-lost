import { evaluate } from '../content/conditions.ts';
import type { AccessLevel } from '../content/schema.ts';

export function deriveAccessLevel(
  levels: readonly AccessLevel[],
  facts: ReadonlySet<string>,
): AccessLevel | undefined {
  let highest: AccessLevel | undefined;
  for (const level of levels) {
    if ((!highest || level.rank > highest.rank) && evaluate(level.when, facts)) highest = level;
  }
  return highest;
}

export function hasAccessLevel(
  levels: readonly AccessLevel[],
  current: AccessLevel | undefined,
  requiredId: string,
): boolean {
  const required = levels.find(({ id }) => id === requiredId);
  return current !== undefined && required !== undefined && current.rank >= required.rank;
}
