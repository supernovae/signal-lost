import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { contentPlugin } from '../../scripts/content-plugin.ts';
import { evaluate } from '../../src/content/conditions.ts';
import { hashContent } from '../../src/content/manifest.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';

const META = { attribution: { author: 'A', handle: 'a', sourcePr: '#1' }, provenance: 'fixture' };

const validFiles = (): Record<string, unknown> => ({
  'content/episodes/e.json': {
    id: 'e',
    title: 'E',
    puzzles: ['p.code'],
    ending: ['END'],
    grants: ['flag:ended'],
    designationPrefix: 'OBS',
  },
  'content/puzzles/code.json': {
    id: 'p.code',
    kind: 'code',
    title: 'Code',
    briefing: ['b'],
    answer: '1',
    feedback: ['no'],
    grants: ['acquired:tx'],
  },
  'content/puzzles/raster.json': {
    id: 'p.raster',
    kind: 'raster',
    title: 'R',
    briefing: [],
    bits: '0101',
    solution: { width: 2, answer: '1' },
    feedback: { width: [], answer: [] },
  },
  'content/puzzles/inquiry.json': {
    id: 'p.inquiry',
    kind: 'inquiry',
    title: 'I',
    briefing: [],
    fields: [{ id: 'f', label: 'F', answer: 'x' }],
    requires: { all: ['solved:p.raster', { not: 'flag:ended' }] },
  },
  'content/puzzles/carrier.json': {
    id: 'p.carrier',
    kind: 'carrier',
    title: 'C',
    briefing: [],
    signal: {
      seed: 1,
      startMhz: 1421,
      binHz: 10,
      bins: 8,
      rows: 8,
      secondsPerRow: 1,
      noiseFloor: 1,
      lines: [{ freqMhz: 1421, driftHzPerSec: 0, amplitude: 1, terrestrial: true }],
    },
    bandwidthsHz: [10],
    solution: { minSnr: 5, toleranceHz: 10 },
    feedback: { terrestrial: [], weak: [], noLine: [] },
  },
  'content/transmissions/tx.json': { id: 'tx', title: 'T', body: ['b'], ...META },
  'content/archives/nested/deep/shared.json': {
    id: 'shared',
    board: 'B',
    title: 'T',
    from: 'F',
    date: 'D',
    body: [],
    ...META,
  },
  'content/characters/echo.json': {
    id: 'echo',
    name: 'ECHO',
    lines: [{ id: 'l', kind: 'idle', text: ['hi'], when: 'read:shared' }],
    ...META,
  },
  'content/sectors/s.json': {
    id: 's',
    name: 'S',
    position: { x: 0, y: 0 },
    description: [],
    visibleWhen: 'completed:e',
    ...META,
  },
  'content/artifacts/a.json': {
    id: 'a',
    name: 'A',
    description: [],
    links: [{ label: 'L', url: 'https://example.com/' }],
    ...META,
  },
  'content/screens/opening.json': { id: 'opening', lines: ['hello'], ...META },
  'content/community/pack.json': {
    id: 'pack',
    title: 'P',
    ...META,
    transmissions: [{ id: 'community.tx', title: 'C', body: ['b'] }],
    archives: [{ id: 'community.ar', board: 'B', title: 'T', from: 'F', date: 'D', body: [] }],
  },
});

function firstError(files: Record<string, unknown>) {
  const { errors } = loadContent(files);
  expect(errors.length).toBeGreaterThan(0);
  return errors[0]!;
}

describe('schemas and loading', () => {
  it('accepts every kind, with and without attribution and provenance', () => {
    const { errors, content } = loadContent(validFiles());
    expect(errors).toEqual([]);
    expect(content.puzzles.map((p) => p.kind).sort()).toEqual([
      'carrier',
      'code',
      'inquiry',
      'raster',
    ]);
    expect(content.screens[0]!.lines).toEqual(['hello']);
    expect(content.episodes[0]!.attribution).toBeUndefined();
    expect(content.sectors[0]!.attribution?.handle).toBe('a');
  });

  it('flattens community entries and inherits package attribution', () => {
    const { content, manifest } = loadContent(validFiles());
    const entry = content.transmissions.find((t) => t.id === 'community.tx');
    expect(entry?.attribution?.author).toBe('A');
    expect(manifest.entries).toContainEqual({
      kind: 'archives',
      id: 'community.ar',
      file: 'content/community/pack.json',
    });
  });

  it('reads nested trees from disk, and reports invalid JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'content-'));
    try {
      for (const [path, value] of Object.entries(validFiles())) {
        const target = join(root, path.replace('content/', ''));
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(value));
      }
      const good = loadContent(readContentDir(root));
      expect(good.errors).toEqual([]);
      expect(good.content.archives.map((a) => a.id)).toContain('shared');
      expect(good.manifest.entries.map((e) => e.id)).toContain('community.tx');

      writeFileSync(join(root, 'transmissions/broken.json'), '{ nope');
      const bad = loadContent(readContentDir(root));
      expect(bad.errors[0]).toMatchObject({
        file: 'content/transmissions/broken.json',
        field: '(file)',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('manifest', () => {
  it('has a version that ignores key order and tracks content', () => {
    expect(hashContent({ f: { a: 1, b: 2 } })).toBe(hashContent({ f: { b: 2, a: 1 } }));
    expect(hashContent({ f: { a: 1 } })).not.toBe(hashContent({ f: { a: 2 } }));
    expect(loadContent(validFiles()).manifest.schemaVersion).toBe(1);
  });
});

describe('conditions', () => {
  const facts = new Set(['flag:a']);
  it.each([
    ['flag:a', true],
    ['flag:b', false],
    [{ all: [] }, true],
    [{ any: [] }, false],
    [{ all: ['flag:a', 'flag:b'] }, false],
    [{ any: ['flag:a', 'flag:b'] }, true],
    [{ not: 'flag:b' }, true],
    [{ any: [{ not: { all: ['flag:a'] } }, { all: ['flag:a', { not: 'flag:b' }] }] }, true],
  ])('%j is %s', (condition, expected) => {
    expect(evaluate(condition, facts)).toBe(expected);
  });
  it('treats no condition as met', () => {
    expect(evaluate(undefined, facts)).toBe(true);
  });
});

describe('diagnostics', () => {
  it('reports invalid fields', () => {
    const files = validFiles();
    (files['content/transmissions/tx.json'] as { body: unknown }).body = 'not a list';
    expect(firstError(files)).toMatchObject({
      file: 'content/transmissions/tx.json',
      field: 'body',
    });
  });

  it('reports invalid community fields with a nested path', () => {
    const files = validFiles();
    (
      files['content/community/pack.json'] as { transmissions: { title: unknown }[] }
    ).transmissions[0]!.title = 7;
    expect(firstError(files)).toMatchObject({
      file: 'content/community/pack.json',
      field: 'transmissions.0.title',
    });
  });

  it('reports duplicate ids, including community entries', () => {
    const files = validFiles();
    (
      files['content/community/pack.json'] as { transmissions: { id: string }[] }
    ).transmissions[0]!.id = 'tx';
    const error = firstError(files);
    expect(error.field).toBe('transmissions.0.id');
    expect(error.message).toContain('duplicate');
  });

  it('allows one id across kinds and resolves each fact to its kind', () => {
    const files = validFiles();
    files['content/transmissions/shared.json'] = { id: 'shared', title: 'T', body: [] };
    (files['content/transmissions/tx.json'] as Record<string, unknown>)['requires'] = 'read:shared';
    expect(loadContent(files).errors).toEqual([]);

    (files['content/transmissions/tx.json'] as Record<string, unknown>)['requires'] =
      'acquired:community.ar';
    expect(firstError(files).message).toContain('no transmissions record');
  });

  it('reports unresolved references', () => {
    const files = validFiles();
    (files['content/episodes/e.json'] as { puzzles: string[] }).puzzles = ['missing'];
    expect(firstError(files)).toMatchObject({
      file: 'content/episodes/e.json',
      field: 'puzzles.0',
    });
  });

  it('reports unknown facts, including ungranted flags and community entries', () => {
    const files = validFiles();
    (files['content/sectors/s.json'] as Record<string, unknown>)['visibleWhen'] = 'flag:nobody';
    expect(firstError(files)).toMatchObject({
      file: 'content/sectors/s.json',
      field: 'visibleWhen',
    });

    const community = validFiles();
    (
      community['content/community/pack.json'] as { archives: Record<string, unknown>[] }
    ).archives[0]!['requires'] = 'solved:ghost';
    expect(firstError(community)).toMatchObject({
      file: 'content/community/pack.json',
      field: 'archives.0.requires',
    });
  });

  it('reports files outside known directories', () => {
    expect(firstError({ 'content/mystery/x.json': {} }).field).toBe('(file)');
  });
});

describe('entry points', () => {
  const roots: string[] = [];
  const tree = (name: string, value: unknown): string => {
    const root = mkdtempSync(join(tmpdir(), 'content-'));
    roots.push(root);
    mkdirSync(join(root, 'transmissions'));
    writeFileSync(join(root, 'transmissions', name), JSON.stringify(value));
    return root;
  };
  afterEach(() => {
    roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
  });
  // Output goes through files: stdio pipes lose data in the validation sandbox.
  const cli = (root: string) => {
    const log = join(root, 'cli.log');
    const fd = openSync(log, 'w');
    const { status } = spawnSync(process.execPath, ['scripts/validate-content.ts', root], {
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    return { status, output: readFileSync(log, 'utf8') };
  };

  it('the CLI exits 0 on valid content', () => {
    const result = cli(tree('t.json', { id: 't', title: 'T', body: [] }));
    expect(result.status).toBe(0);
    expect(result.output).toContain('Content OK: 1 records');
  });

  it('the CLI exits 1 and names the file and field on invalid content', () => {
    const result = cli(tree('t.json', { id: 't', title: 'T' }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('content/transmissions/t.json: body:');
  });

  it('the build rejects invalid content', async () => {
    const root = tree('t.json', { id: 'BAD ID', title: 'T', body: [] });
    await expect(
      build({
        configFile: false,
        logLevel: 'silent',
        plugins: [contentPlugin(root)],
        build: { write: false },
      }),
    ).rejects.toThrow(/content\/transmissions\/t\.json: id:/);
  });
});
