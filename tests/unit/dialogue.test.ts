import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { characterSchema, puzzleSchema, type Character } from '../../src/content/schema.ts';
import { createScriptedDialogue } from '../../src/narrative/dialogue.ts';
import { freshSave, loadSave, writeSave } from '../../src/progress/save.ts';
import { createGame } from '../../src/puzzle/game.ts';
import { emptyContent } from './helpers.ts';

const character: Character = characterSchema.parse({
  id: 'echo',
  name: 'ECHO',
  lines: [
    { id: 'idle', kind: 'idle', text: ['idle'] },
    { id: 'low', kind: 'hint', text: ['low'], priority: 1 },
    { id: 'tie', kind: 'hint', text: ['tie'], priority: 1 },
    {
      id: 'high',
      kind: 'hint',
      text: ['high'],
      priority: 2,
      failures: { puzzle: 'p', atLeast: 2 },
    },
    { id: 'react', kind: 'reaction', when: 'solved:p', text: ['react'], once: true },
    { id: 'rev.a', kind: 'reaction', when: 'flag:manual', text: ['Rev A says 714'], priority: 3 },
    {
      id: 'rev.c',
      kind: 'reaction',
      when: { all: ['flag:manual', 'flag:asked'] },
      text: ['Rev C says 417'],
      priority: 4,
    },
  ],
});
const source = createScriptedDialogue(character);
const state = (facts: string[] = [], seen: string[] = [], failures = {}) => ({
  facts: new Set(facts),
  seen: new Set(seen),
  failures,
});

describe('scripted dialogue', () => {
  it('selects by kind and state', () => {
    expect(source.next('idle', state())?.id).toBe('idle');
    expect(source.next('reaction', state())).toBeUndefined();
    expect(source.next('reaction', state(['solved:p']))?.id).toBe('react');
  });

  it('prefers higher priority and breaks ties in file order', () => {
    expect(source.next('hint', state())?.id).toBe('low');
  });

  it('escalates hints as failures build', () => {
    expect(source.next('hint', state([], [], { p: 1 }))?.id).toBe('low');
    expect(source.next('hint', state([], [], { p: 2 }))?.id).toBe('high');
  });

  it('does not repeat a once-only line', () => {
    expect(source.next('reaction', state(['solved:p'], ['react']))).toBeUndefined();
  });

  it('can surface records that contradict each other as state changes', () => {
    const first = source.next('reaction', state(['flag:manual']));
    const second = source.next('reaction', state(['flag:manual', 'flag:asked']));
    expect(first?.text).toEqual(['Rev A says 714']);
    expect(second?.text).toEqual(['Rev C says 417']);
  });
});

describe('dialogue memory', () => {
  it('stays suppressed after a save round trip', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    const puzzle = puzzleSchema.parse({
      id: 'p',
      kind: 'code',
      title: 'C',
      briefing: [],
      answer: '1',
      feedback: [],
    });
    const content = { ...emptyContent(), puzzles: [puzzle] };
    const play = (data = freshSave()) =>
      createGame({
        content,
        data,
        persist: (latest) => writeSave(storage, latest),
        designationSeed: () => 1,
      });

    const game = play();
    game.attempt('p', { kind: 'code', code: '1' });
    expect(game.say(source, 'reaction')?.id).toBe('react');

    const reloaded = play(loadSave(storage).data);
    expect(reloaded.isSolved('p')).toBe(true);
    expect(reloaded.say(source, 'reaction')).toBeUndefined();
  });
});

describe('ECHO content', () => {
  const echo = characterSchema.parse(
    JSON.parse(readFileSync('content/characters/echo.json', 'utf8')),
  );

  it('never gives the carrier solution in a hint', () => {
    const hints = echo.lines.filter((line) => line.kind === 'hint').flatMap((line) => line.text);
    expect(hints.length).toBeGreaterThan(0);
    for (const hint of hints) {
      expect(hint).not.toMatch(/1421|0\.42|\b200\b/);
    }
  });

  it('escalates through at least three levels for the carrier', () => {
    const levels = echo.lines.filter((l) => l.id.startsWith('echo.carrier.hint'));
    expect(new Set(levels.map((l) => l.priority)).size).toBeGreaterThanOrEqual(3);
  });
});
