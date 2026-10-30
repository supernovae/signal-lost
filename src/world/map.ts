import { evaluate } from '../content/conditions.ts';
import type { Sector } from '../content/schema.ts';

export interface MapNode {
  sector: Sector;
  enterable: boolean;
}

export function mapNodes(sectors: readonly Sector[], facts: ReadonlySet<string>): MapNode[] {
  return sectors
    .filter((sector) => evaluate(sector.visibleWhen, facts))
    .map((sector) => ({ sector, enterable: evaluate(sector.enterableWhen, facts) }));
}
