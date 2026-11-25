import { evaluate } from '../content/conditions.ts';
import type { Content, DialogueLine, Puzzle } from '../content/schema.ts';
import type { DialogueSource, DialogueState } from '../narrative/dialogue.ts';
import { completeEpisodes } from '../progress/episodes.ts';
import { settleEvents } from '../progress/events.ts';
import { addFact, factsOf, type SaveData } from '../progress/save.ts';
import { evaluateAnswer, type Answer } from './evaluate.ts';

export interface AttemptResult {
  status: 'locked' | 'wrong' | 'solved' | 'already-solved';
  feedback: readonly string[];
  consistent?: number;
  /** Facts newly gained by this attempt. */
  granted: string[];
}

export interface GameOptions {
  content: Pick<Content, 'puzzles' | 'episodes' | 'events' | 'transmissions' | 'archives'>;
  data: SaveData;
  persist(data: SaveData): void;
}

export interface Game {
  readonly data: SaveData;
  facts(): Set<string>;
  puzzle(id: string): Puzzle;
  isAvailable(id: string): boolean;
  isSolved(id: string): boolean;
  attempt(id: string, answer: Answer): AttemptResult;
  grant(facts: readonly string[]): string[];
  dialogueState(): DialogueState;
  /** Asks a source for a line and remembers it in the save. */
  say(source: DialogueSource, kind: DialogueLine['kind']): DialogueLine | undefined;
  transmissions(): Content['transmissions'];
  archives(): Content['archives'];
}

export function createGame({ content, data, persist }: GameOptions): Game {
  const puzzle = (id: string): Puzzle => {
    const found = content.puzzles.find((p) => p.id === id);
    if (!found) throw new Error(`unknown puzzle ${id}`);
    return found;
  };

  const grant = (facts: readonly string[]): string[] => {
    const known = factsOf(data);
    const added = facts.filter((fact) => !known.has(fact));
    added.forEach((fact) => addFact(data, fact));
    return added;
  };

  const game: Game = {
    data,
    facts: () => factsOf(data),
    puzzle,
    isAvailable: (id) => evaluate(puzzle(id).requires, factsOf(data)),
    isSolved: (id) => data.puzzles.includes(id),
    attempt(id, answer) {
      const target = puzzle(id);
      if (game.isSolved(id)) return { status: 'already-solved', feedback: [], granted: [] };
      if (!game.isAvailable(id)) return { status: 'locked', feedback: [], granted: [] };
      const { correct, feedback, consistent } = evaluateAnswer(target, answer);
      const base = consistent === undefined ? {} : { consistent };
      if (!correct) {
        data.failures[id] = (data.failures[id] ?? 0) + 1;
        persist(data);
        return { status: 'wrong', feedback, granted: [], ...base };
      }
      const granted = grant([`solved:${id}`, ...target.grants]);
      granted.push(...completeEpisodes(content.episodes, data).granted);
      settleEvents(content.events, data);
      persist(data);
      return { status: 'solved', feedback, granted, ...base };
    },
    grant(facts) {
      const added = grant(facts);
      if (added.length > 0) {
        settleEvents(content.events, data);
        persist(data);
      }
      return added;
    },
    dialogueState: () => ({
      facts: factsOf(data),
      seen: new Set(data.seenLines),
      failures: data.failures,
    }),
    say(source, kind) {
      const line = source.next(kind, game.dialogueState());
      if (line && !data.seenLines.includes(line.id)) {
        data.seenLines.push(line.id);
        persist(data);
      }
      return line;
    },
    transmissions: () => content.transmissions.filter((t) => evaluate(t.requires, factsOf(data))),
    archives: () => content.archives.filter((a) => evaluate(a.requires, factsOf(data))),
  };
  return game;
}
