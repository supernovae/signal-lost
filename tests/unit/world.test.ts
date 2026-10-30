import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import { freshSave } from '../../src/progress/save.ts';
import { evaluateAnswer } from '../../src/puzzle/evaluate.ts';
import { createGame } from '../../src/puzzle/game.ts';
import { searchArchives } from '../../src/world/archive.ts';
import { mapNodes } from '../../src/world/map.ts';

const { content, errors } = loadContent(readContentDir(resolve('content')));
const DONE = 'completed:episode.000';
const body = (id: string) => content.archives.find((a) => a.id === id)!.body;
const service = content.puzzles.find((p) => p.id === 'puzzle.service')!;

function parseMarks(id: string): Map<string, number> {
  const rows = body(id)
    .filter((line) => line.startsWith('MARK'))
    .map((line) => line.slice(6).split('  '));
  const marks = new Map<string, number>();
  for (let value = 0; value < 10; value++) {
    marks.set(rows.map((row) => row[value]).join('/'), value);
  }
  return marks;
}

function readTrace(marks: Map<string, number>): string {
  const rows = body('lore.meter-trace')
    .filter((line) => /^[#.]{3}  [#.]{3}  [#.]{3}$/.test(line))
    .map((line) => line.split('  '));
  expect(rows).toHaveLength(5);
  return [0, 1, 2].map((i) => String(marks.get(rows.map((r) => r[i]).join('/')))).join('');
}

describe('network map', () => {
  it('has valid content', () => {
    expect(errors).toEqual([]);
  });

  it('shows nothing until the episode ends, then all three locations', () => {
    expect(mapNodes(content.sectors, new Set())).toEqual([]);
    const nodes = mapNodes(content.sectors, new Set([DONE]));
    expect(Object.fromEntries(nodes.map((n) => [n.sector.id, n.enterable]))).toEqual({
      'relay-07': true,
      'the-archive': true,
      'silent-observatory': false,
    });
  });

  it('answers NO CARRIER from the Silent Observatory, as an authored hook', () => {
    const sector = content.sectors.find((s) => s.id === 'silent-observatory')!;
    expect(sector.lockedText[0]).toBe('NO CARRIER');
    expect(sector.lockedText.join(' ')).toContain('2 OBSERVERS REQUIRED');
    expect(sector.lockedText.join(' ')).not.toMatch(/coming soon/i);
  });

  it('adds lore to the Archive only after the episode', () => {
    const lore = ['lore.meter-trace', 'lore.last-sysop', 'lore.oyelaran'];
    const game = (done: boolean) => {
      const data = freshSave();
      if (done) data.episodes.push('episode.000');
      return createGame({ content, data, persist: () => {}, designationSeed: () => 1 });
    };
    const ids = (done: boolean) => searchArchives(game(done).archives(), '').map((a) => a.id);
    lore.forEach((id) => expect(ids(false)).not.toContain(id));
    lore.forEach((id) => expect(ids(true)).toContain(id));
  });
});

describe('the optional discovery', () => {
  it('is solved by reading the meter trace with the manual in force', () => {
    expect(readTrace(parseMarks('manual.rev-c'))).toBe('709');
    expect(evaluateAnswer(service, { kind: 'code', code: '7-0-9' }).correct).toBe(true);
  });

  it('refuses the reading from the superseded manual', () => {
    expect(readTrace(parseMarks('manual.rev-a'))).toBe('409');
    expect(evaluateAnswer(service, { kind: 'code', code: '409' }).correct).toBe(false);
  });

  it('is not required to finish the episode', () => {
    const episode = content.episodes.find((e) => e.id === 'episode.000')!;
    expect(episode.puzzles).not.toContain('puzzle.service');
  });

  it('persists its flag', () => {
    const data = freshSave();
    data.episodes.push('episode.000');
    const game = createGame({ content, data, persist: () => {}, designationSeed: () => 1 });
    expect(game.attempt('puzzle.service', { kind: 'code', code: '709' }).status).toBe('solved');
    expect(data.flags).toContain('service-panel-open');
  });
});
