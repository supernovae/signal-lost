import type { Content } from '../../src/content/schema.ts';

export function emptyContent(): Content {
  return {
    episodes: [],
    puzzles: [],
    transmissions: [],
    archives: [],
    bbs: [],
    doors: [],
    characters: [],
    sectors: [],
    artifacts: [],
    screens: [],
    community: [],
  };
}
