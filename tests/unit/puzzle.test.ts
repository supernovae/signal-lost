import { describe, expect, it, vi } from 'vitest';
import type { Content, Puzzle } from '../../src/content/schema.ts';
import { loadContent } from '../../src/content/validate.ts';
import { evaluateAnswer, normalize } from '../../src/puzzle/evaluate.ts';
import { createGame } from '../../src/puzzle/game.ts';
import { freshSave } from '../../src/progress/save.ts';

const { content, errors } = loadContent({
  'content/episodes/e.json': {
    id: 'e',
    title: 'E',
    puzzles: ['raster', 'inquiry'],
    ending: [],
    grants: ['flag:ended'],
    designationPrefix: 'OBS',
  },
  'content/puzzles/raster.json': {
    id: 'raster',
    kind: 'raster',
    title: 'R',
    briefing: [],
    bits: '0101',
    solution: { width: 2, answer: '4-1-7' },
    knownWrong: [{ answer: '714', feedback: ['WRONG REV'] }],
    feedback: { width: ['BAD WIDTH'], answer: ['BAD REF'] },
    grants: ['acquired:tx'],
    success: ['RASTER OK'],
  },
  'content/puzzles/inquiry.json': {
    id: 'inquiry',
    kind: 'inquiry',
    title: 'I',
    briefing: [],
    requires: 'solved:raster',
    fields: [
      { id: 'date', label: 'D', answer: '1999-11-02' },
      { id: 'who', label: 'W', answer: 'moye' },
    ],
    success: ['DONE'],
  },
  'content/puzzles/code.json': {
    id: 'code',
    kind: 'code',
    title: 'C',
    briefing: [],
    answer: 'A-1',
    feedback: ['NO'],
  },
  'content/puzzles/carrier.json': {
    id: 'carrier',
    kind: 'carrier',
    title: 'C',
    briefing: [],
    signal: {
      seed: 1,
      startMhz: 1,
      binHz: 1,
      bins: 1,
      rows: 1,
      secondsPerRow: 1,
      noiseFloor: 1,
      lines: [{ freqMhz: 1, driftHzPerSec: 0, amplitude: 1, terrestrial: false }],
    },
    bandwidthsHz: [1],
    solution: { minSnr: 1, toleranceHz: 1 },
    feedback: { terrestrial: ['T'], weak: ['W'], noLine: ['N'] },
    success: ['LOCKED'],
  },
  'content/transmissions/tx.json': { id: 'tx', title: 'T', body: [], requires: 'acquired:tx' },
  'content/transmissions/open.json': { id: 'open', title: 'O', body: [] },
});

const byId = (id: string): Puzzle => content.puzzles.find((p) => p.id === id)!;

function newGame(contentSet: Content = content) {
  const persist = vi.fn();
  const data = freshSave();
  const game = createGame({ content: contentSet, data, persist, designationSeed: () => 42 });
  return { game, data, persist };
}

describe('evaluation', () => {
  it('has valid fixtures', () => {
    expect(errors).toEqual([]);
  });

  it('normalises text answers', () => {
    expect(normalize(' 4-1 7 ')).toBe('417');
    expect(normalize('moye')).toBe('MOYE');
  });

  it('gives the same result for the same answer', () => {
    const answer = { kind: 'code', code: 'nope' } as const;
    expect(evaluateAnswer(byId('code'), answer)).toEqual(evaluateAnswer(byId('code'), answer));
  });

  it('evaluates the carrier by lock outcome, with specific feedback', () => {
    const puzzle = byId('carrier');
    expect(evaluateAnswer(puzzle, { kind: 'carrier', outcome: 'locked' }).correct).toBe(true);
    for (const [outcome, text] of [
      ['terrestrial', 'T'],
      ['weak', 'W'],
      ['no-line', 'N'],
    ] as const) {
      const result = evaluateAnswer(puzzle, { kind: 'carrier', outcome });
      expect(result).toEqual({ correct: false, feedback: [text] });
    }
  });

  it('evaluates raster width, known wrong answers, and the reference', () => {
    const puzzle = byId('raster');
    const answer = (width: number, reference: string) =>
      evaluateAnswer(puzzle, { kind: 'raster', width, reference });
    expect(answer(3, '417').feedback).toEqual(['BAD WIDTH']);
    expect(answer(2, '714').feedback).toEqual(['WRONG REV']);
    expect(answer(2, '111').feedback).toEqual(['BAD REF']);
    expect(answer(2, '4 1 7').correct).toBe(true);
  });

  it('reveals only how many inquiry fields are consistent', () => {
    const result = evaluateAnswer(byId('inquiry'), {
      kind: 'inquiry',
      fields: { date: '1999-11-02', who: 'nobody' },
    });
    expect(result).toEqual({ correct: false, feedback: [], consistent: 1 });
  });

  it('evaluates a code', () => {
    expect(evaluateAnswer(byId('code'), { kind: 'code', code: 'a1' }).correct).toBe(true);
  });
});

describe('game', () => {
  const solveRaster = { kind: 'raster', width: 2, reference: '417' } as const;
  const solveInquiry = {
    kind: 'inquiry',
    fields: { date: '1999-11-02', who: 'MOYE' },
  } as const;

  it('blocks locked puzzles and changes nothing', () => {
    const { game, data, persist } = newGame();
    expect(game.attempt('inquiry', solveInquiry).status).toBe('locked');
    expect(data.puzzles).toEqual([]);
    expect(data.failures).toEqual({});
    expect(persist).not.toHaveBeenCalled();
  });

  it('counts failures and persists them', () => {
    const { game, data, persist } = newGame();
    expect(game.attempt('raster', { ...solveRaster, reference: '000' }).status).toBe('wrong');
    expect(data.failures['raster']).toBe(1);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('grants content-defined facts and unlocks what they gate', () => {
    const { game } = newGame();
    expect(game.transmissions().map((t) => t.id)).toEqual(['open']);
    const result = game.attempt('raster', solveRaster);
    expect(result.status).toBe('solved');
    expect(result.granted).toEqual(['solved:raster', 'acquired:tx']);
    expect(game.isAvailable('inquiry')).toBe(true);
    expect(game.transmissions().map((t) => t.id)).toContain('tx');
    expect(game.attempt('raster', solveRaster).status).toBe('already-solved');
  });

  it('completes an episode once, with a stable designation for a seed', () => {
    const { game, data } = newGame();
    game.attempt('raster', solveRaster);
    expect(data.designation).toBeNull();
    const result = game.attempt('inquiry', solveInquiry);
    expect(result.granted).toContain('completed:e');
    expect(result.granted).toContain('flag:ended');
    const designation = data.designation;
    expect(designation).toMatch(/^OBS-[0-9A-F]{4}$/);

    const again = newGame();
    again.game.attempt('raster', solveRaster);
    again.game.attempt('inquiry', solveInquiry);
    expect(again.data.designation).toBe(designation);
  });
});
