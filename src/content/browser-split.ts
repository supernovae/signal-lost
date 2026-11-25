import type { BbsBoard, Content } from './schema.ts';

type Endpoint = Pick<BbsBoard, 'id' | 'requires' | 'title' | 'notice'>;

export function projectEntryContent(content: Content) {
  const { screens, accessLevels, puzzles, transmissions, archives, artifacts, sectors } = content;
  const endpoints = content.bbs.flatMap((record): Endpoint[] => {
    if (record.kind !== 'board') return [];
    const { id, requires, title, notice } = record;
    return [{ id, requires, title, notice }];
  });
  const bbsCompletions = new Set(
    content.episodes.filter(({ puzzles }) => !puzzles.length).map(({ id }) => `completed:${id}`),
  );
  return {
    screens,
    accessLevels,
    puzzles,
    episodes: content.episodes.filter(({ puzzles }) => puzzles.length > 0),
    transmissions,
    archives,
    artifacts,
    sectors,
    endpoints,
    characters: projectCharacters(content, false),
    events: content.events.filter(
      ({ when }) =>
        typeof when !== 'string' || (!when.startsWith('bbs-read:') && !bbsCompletions.has(when)),
    ),
  };
}

export function projectBbsContent(content: Content) {
  const { bbs, doors, events, repairManifests } = content;
  return {
    bbs,
    doors,
    events,
    repairManifests,
    episodes: content.episodes.filter(({ completionFacts }) => completionFacts !== undefined),
    characters: projectCharacters(content, true),
  };
}

function projectCharacters(content: Content, bbs: boolean): Content['characters'] {
  return content.characters.map((character) => ({
    ...character,
    lines: character.lines.filter((line) => (line.kind === 'bbs') === bbs),
  }));
}

export type EntryContent = ReturnType<typeof projectEntryContent>;
export type BbsContent = ReturnType<typeof projectBbsContent>;
