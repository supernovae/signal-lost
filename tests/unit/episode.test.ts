import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CarrierPuzzle, RasterPuzzle } from '../../src/content/schema.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import { freshSave } from '../../src/progress/save.ts';
import { createGame } from '../../src/puzzle/game.ts';
import { renderRaster } from '../../src/puzzle/raster-view.ts';
import { searchArchives } from '../../src/world/archive.ts';

const { content, errors } = loadContent(readContentDir(resolve('content')));
const puzzle = (id: string) => content.puzzles.find((p) => p.id === id)!;
const carrier = puzzle('puzzle.carrier') as CarrierPuzzle;
const pattern = puzzle('puzzle.pattern') as RasterPuzzle;
const archiveBody = (id: string) => content.archives.find((a) => a.id === id)!.body;
const episode = content.episodes.find((e) => e.id === 'episode.000')!;

const ANSWERS = {
  carrier: { kind: 'carrier', outcome: 'locked' },
  pattern: { kind: 'raster', width: 13, reference: '4-1-7' },
  archive: {
    kind: 'inquiry',
    fields: { 'first-receipt': '1999-11-02', 'ordered-by': 'MOYE', status: 'RUNNING' },
  },
} as const;

function newGame() {
  const data = freshSave();
  return {
    data,
    game: createGame({ content, data, persist: () => {}, designationSeed: () => 7 }),
  };
}

/** Parses the survey-mark table printed in a manual, using the same text a player reads. */
function parseMarks(id: string): Map<string, number> {
  const rows = archiveBody(id)
    .filter((line) => line.startsWith('MARK'))
    .map((line) => line.slice(6).split('  '));
  expect(rows).toHaveLength(5);
  const marks = new Map<string, number>();
  for (let value = 0; value < 10; value++) {
    marks.set(rows.map((row) => row[value]).join('/'), value);
  }
  return marks;
}

function readRaster(marks: Map<string, number>): string {
  const rows = renderRaster(pattern.bits, 13).split('\n');
  return [1, 5, 9]
    .map((x) => {
      const key = rows
        .slice(1, 6)
        .map((row) => row.slice(x, x + 3))
        .join('/');
      return String(marks.get(key));
    })
    .join('');
}

describe('episode content', () => {
  it('is valid', () => {
    expect(errors).toEqual([]);
  });

  it('uses three different kinds of reasoning, in order', () => {
    expect(episode.puzzles.map((id) => puzzle(id).kind)).toEqual(['carrier', 'raster', 'inquiry']);
  });

  it('has enough to read', () => {
    expect(content.transmissions.length).toBeGreaterThanOrEqual(3);
    expect(content.archives.length).toBeGreaterThanOrEqual(6);
  });
});

describe('the pattern', () => {
  it('forms marks only at width 13 of the two factors of 91', () => {
    expect(pattern.bits).toHaveLength(91);
    const divisors = [];
    for (let w = 2; w < 91; w++) if (91 % w === 0) divisors.push(w);
    expect(divisors).toEqual([7, 13]);
    expect(pattern.solution.width).toBe(13);
    expect(readRaster(parseMarks('manual.rev-c'))).toBe('417');
  });

  it('reads differently under the superseded manual', () => {
    expect(readRaster(parseMarks('manual.rev-a'))).toBe('714');
    expect(archiveBody('manual.rev-c').join(' ')).toContain('SUPERSEDES');
    const a = content.archives.find((x) => x.id === 'manual.rev-a')!;
    const c = content.archives.find((x) => x.id === 'manual.rev-c')!;
    expect(a.date < c.date).toBe(true);
  });

  it('accepts Rev C and answers Rev A specifically', () => {
    const { game } = newGame();
    game.attempt('puzzle.carrier', ANSWERS.carrier);
    const wrong = game.attempt('puzzle.pattern', { ...ANSWERS.pattern, reference: '7-1-4' });
    expect(wrong.status).toBe('wrong');
    expect(wrong.feedback).toEqual(pattern.knownWrong[0]!.feedback);
    expect(game.attempt('puzzle.pattern', ANSWERS.pattern).status).toBe('solved');
  });
});

describe('connected clues', () => {
  it('refuses each puzzle before the last is solved', () => {
    const { game } = newGame();
    expect(game.attempt('puzzle.pattern', ANSWERS.pattern).status).toBe('locked');
    expect(game.attempt('puzzle.archive', ANSWERS.archive).status).toBe('locked');
    game.attempt('puzzle.carrier', ANSWERS.carrier);
    expect(game.attempt('puzzle.archive', ANSWERS.archive).status).toBe('locked');
  });

  it('hides the logbook until the pattern is solved, then only from the grid reference', () => {
    const { game } = newGame();
    const found = (query: string) => searchArchives(game.archives(), query).map((a) => a.id);

    game.attempt('puzzle.carrier', ANSWERS.carrier);
    expect(found('417')).not.toContain('relay07.logbook');

    game.attempt('puzzle.pattern', ANSWERS.pattern);
    expect(found('')).not.toContain('relay07.logbook');
    expect(found('relay')).not.toContain('relay07.logbook');
    expect(found('417')).toContain('relay07.logbook');
    expect(found('417')).toContain('relay07.ledger');
    expect(found('417')).toContain('bbs.keel');
  });

  it('needs the tuned carrier to pick the logbook line', () => {
    const target = carrier.signal.lines.find((line) => !line.terrestrial)!;
    const log = archiveBody('relay07.logbook');
    const matches = log.filter(
      (line) =>
        line.includes(target.freqMhz.toFixed(2)) && line.includes(target.driftHzPerSec.toFixed(2)),
    );
    expect(matches[0]).toMatch(/^99306/);
    expect(log.some((line) => line.includes('1421.37') && line.includes('+0.42'))).toBe(true);
    // Day 306 of 1999 is 2 November, and 2001's day 73 is the official date.
    const date = (year: number, day: number) =>
      new Date(Date.UTC(year, 0, day)).toISOString().slice(0, 10);
    expect(date(1999, 306)).toBe('1999-11-02');
    expect(date(2001, 73)).toBe('2001-03-14');
    expect(archiveBody('press.release').join(' ')).toContain('14 MARCH 2001');
  });

  it('reports only a count for a partly right reconstruction', () => {
    const { game } = newGame();
    game.attempt('puzzle.carrier', ANSWERS.carrier);
    game.attempt('puzzle.pattern', ANSWERS.pattern);
    const result = game.attempt('puzzle.archive', {
      kind: 'inquiry',
      fields: { ...ANSWERS.archive.fields, 'ordered-by': 'MOYEN' },
    });
    expect(result).toMatchObject({ status: 'wrong', consistent: 2, feedback: [] });
  });

  it('separates the director from the coordinator in the evidence', () => {
    const roster = archiveBody('personnel.roster').join('\n');
    expect(roster).toMatch(/MOYE +.*DIRECTOR/);
    expect(roster).toMatch(/MOYEN +.*COORDINATOR/);
    expect(archiveBody('ops.peer-policy').join(' ')).toContain('PROJECT DIRECTOR');
  });

  it('shows the relay drawing power after it was reported closed', () => {
    const ledger = archiveBody('relay07.ledger').join('\n');
    expect(ledger).toContain('DECOMMISSIONED');
    expect(ledger).toContain('METER TURNING');
  });
});

describe('the ending', () => {
  const groups = (bits: string) => (bits.match(/.{1,13}/g) ?? []).join(' ');

  it('completes the episode and awards a designation', () => {
    const { game, data } = newGame();
    game.attempt('puzzle.carrier', ANSWERS.carrier);
    game.attempt('puzzle.pattern', ANSWERS.pattern);
    const result = game.attempt('puzzle.archive', ANSWERS.archive);
    expect(result.status).toBe('solved');
    expect(result.granted).toContain('completed:episode.000');
    expect(data.designation).toMatch(/^OBS-[0-9A-F]{4}$/);
    expect(game.transmissions().map((t) => t.id)).toContain('tx.reconstructed');
  });

  it('proves the handshake came from the signal, then gives the exact ending', () => {
    const text = episode.ending.join('\n');
    const block = [
      'RELAY 07: RECOVERED',
      'NETWORK INTEGRITY: 0.0007%',
      'OBSERVERS ONLINE: 1',
      '',
      'THE SIGNAL WAS NOT A MESSAGE.',
      '',
      'IT WAS AN INVITATION.',
    ].join('\n');
    expect(text.endsWith(block)).toBe(true);
    expect(text.indexOf('The specification came later')).toBeLessThan(text.indexOf(block));

    const frame = groups(pattern.bits);
    const reconstructed = content.transmissions.find((t) => t.id === 'tx.reconstructed')!;
    expect(reconstructed.body.filter((line) => line === frame)).toHaveLength(2);
    expect(episode.ending.filter((line) => line === frame)).toHaveLength(2);
    expect(archiveBody('spec.handshake').join(' ')).toContain('91 BITS, 7 ROWS OF 13');
    const spec = content.archives.find((a) => a.id === 'spec.handshake')!;
    expect(spec.date).toBe('2000-01-17');
  });
});

describe('ECHO', () => {
  const echo = content.characters.find((c) => c.id === 'echo')!;

  it('has hints and a reaction for every puzzle', () => {
    for (const id of episode.puzzles) {
      const short = id.replace('puzzle.', '');
      expect(echo.lines.filter((l) => l.id.startsWith(`echo.${short}.hint`)).length).toBe(3);
      expect(echo.lines.some((l) => l.id === `echo.${short}.solved`)).toBe(true);
    }
  });

  it('never states a solution in a hint', () => {
    const hints = echo.lines.filter((l) => l.kind === 'hint').flatMap((l) => l.text);
    for (const hint of hints) {
      expect(hint).not.toMatch(/1421|0\.42|\b13\b|\b91\b|417|4-1-7|99306|1999-11-02|MOYE|RUNNING/);
    }
  });

  it('contradicts itself about the relay and the manual', () => {
    const ledger = echo.lines.find((l) => l.id === 'echo.ledger.read')!.text.join(' ');
    expect(ledger).toContain('lost in a storm');
    expect(ledger).toContain('cannot both be mine');
    const manual = echo.lines.find((l) => l.id === 'echo.pattern.hint.3')!.text.join(' ');
    expect(manual).toContain('Trust neither of me');
  });
});
