import type { Content } from '../../src/content/schema.ts';

export function emptyContent(): Content {
  return {
    episodes: [],
    puzzles: [],
    transmissions: [],
    archives: [],
    bbs: [],
    characters: [],
    sectors: [],
    artifacts: [],
    screens: [],
    community: [],
  };
}
