import type { Content } from '../../src/content/schema.ts';

export function emptyContent(): Content {
  return {
    accessLevels: [],
    capabilities: [],
    episodes: [],
    puzzles: [],
    transmissions: [],
    archives: [],
    bbs: [],
    events: [],
    doors: [],
    characters: [],
    sectors: [],
    artifacts: [],
    screens: [],
    community: [],
    repairManifests: [],
  };
}
