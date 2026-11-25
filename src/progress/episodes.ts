import type { Episode } from '../content/schema.ts';
import { mulberry32 } from '../signal/rng.ts';
import { addFact, factsOf, type SaveData } from './save.ts';

/** Applies puzzle and saved-fact requirements to the caller's candidate save. */
export function completeEpisodes(episodes: readonly Episode[], data: SaveData) {
  const facts = factsOf(data);
  const completed: Episode[] = [];
  const granted: string[] = [];
  for (const episode of episodes) {
    const completion = `completed:${episode.id}`;
    if (facts.has(completion)) continue;
    if (!episode.puzzles.every((id) => facts.has(`solved:${id}`))) continue;
    if (episode.completionFacts?.some((fact) => !facts.has(fact))) continue;
    for (const fact of [completion, ...episode.grants]) {
      if (facts.has(fact)) continue;
      addFact(data, fact);
      facts.add(fact);
      granted.push(fact);
    }
    completed.push(episode);
    if (data.profile.designation === null && episode.designationPrefix !== undefined) {
      const suffix = Math.floor(mulberry32(data.profile.seed)() * 0xffff);
      const hex = suffix.toString(16).toUpperCase().padStart(4, '0');
      data.profile.designation = `${episode.designationPrefix}-${hex}`;
    }
  }
  return { completed, granted };
}
