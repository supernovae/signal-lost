import { spawnSync } from 'node:child_process';
import {
  closeSync,
  cpSync,
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
import { getBbsOffer } from '../../src/bbs/bbs.ts';
import { createBbsDoorSession } from '../../src/bbs/door-session.ts';
import { evaluate } from '../../src/content/conditions.ts';
import { hashContent } from '../../src/content/manifest.ts';
import { readContentDir } from '../../src/content/node.ts';
import type { DoorMetadata, TriviaDoor } from '../../src/content/schema.ts';
import { loadContent } from '../../src/content/validate.ts';
import type { CodeDoorRegistration } from '../../src/doors/contract.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { factsOf, freshSave } from '../../src/progress/save.ts';

const META = { attribution: { author: 'A', handle: 'a', sourcePr: '#1' }, provenance: 'fixture' };
const DOOR_FILE = 'content/doors/test.json';
const DOOR_META: DoorMetadata = {
  ...META,
  id: 'test-quiz',
  name: 'Test quiz',
  description: 'Equipment test',
  version: 1,
  requires: 'completed:e',
  rewards: ['flag:quiz-complete'],
  returnTo: 'bbs-menu',
};

const trivia = (): TriviaDoor => ({
  ...DOOR_META,
  kind: 'trivia',
  saveState: 'question-index',
  completion: 'all-correct',
  questions: [{ prompt: ['Choose one'], options: ['Yes', 'No'], answer: 0, retry: ['Try again'] }],
  success: ['Quiz filed'],
});

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
  'content/bbs/board.json': {
    kind: 'board',
    id: 'board',
    title: 'Board',
    requires: 'completed:e',
    notice: 'Incoming',
    banner: ['Connected'],
    sysopGreeting: ['Welcome'],
    archiveIds: ['shared'],
  },
  'content/bbs/message.json': {
    kind: 'message',
    id: 'post',
    board: 'board',
    title: 'Post',
    from: 'A',
    date: '2001-03-01',
    body: ['Hello'],
    ...META,
  },
  [DOOR_FILE]: trivia(),
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
    expect(content.bbs.map((entry) => entry.kind)).toEqual(['board', 'message']);
    expect(content.doors.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'test-quiz', kind: 'trivia' },
    ]);
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
      expect(good.manifest.entries).toContainEqual({
        kind: 'bbs',
        id: 'post',
        file: 'content/bbs/message.json',
      });
      expect(good.manifest.entries).toContainEqual({
        kind: 'doors',
        id: 'test-quiz',
        file: DOOR_FILE,
      });

      writeFileSync(join(root, 'doors/broken.json'), '{ nope');
      expect(loadContent(readContentDir(root)).errors).toEqual([
        expect.objectContaining({ file: 'content/doors/broken.json', field: '(file)' }),
      ]);
      rmSync(join(root, 'doors/broken.json'));

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

  it('discovers and plays a door added as one JSON file to a copy of the real content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'content-door-'));
    try {
      cpSync('content', root, { recursive: true });
      const before = loadContent(readContentDir(root));
      expect(before.errors).toEqual([]);
      expect(before.content.doors.map(({ id }) => id)).not.toContain('test-quiz');

      writeFileSync(
        join(root, 'doors/test.json'),
        JSON.stringify({ ...trivia(), requires: 'completed:episode.000' }),
      );
      const after = loadContent(readContentDir(root));
      expect(after.errors).toEqual([]);
      expect(after.manifest.entries).toContainEqual({
        kind: 'doors',
        id: 'test-quiz',
        file: DOOR_FILE,
      });
      const data = freshSave(42);
      data.episodes.push('episode.000');
      const offer = getBbsOffer(after.content, factsOf(data))!;
      const host = createDoorHost(createDoorRegistry(after.content.doors), data, () => true);
      const bbs = createBbsDoorSession(offer, () => data, host);
      await bbs.dispatch('CONNECT');
      await bbs.dispatch('LOGIN Finch');
      await bbs.dispatch('DOORS');
      const action = bbs.screen().actions.find(({ command }) => command === 'OPEN test-quiz')!;
      expect(action.label).toBe('Test quiz');
      expect((await bbs.dispatch(action.command))!.output.flatMap(({ lines }) => lines)).toContain(
        'Choose one',
      );
      expect((await bbs.dispatch('1'))!.output.flatMap(({ lines }) => lines)).toContain(
        'Quiz filed',
      );
      expect(data.flags).toContain('quiz-complete');
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
  it.each([
    [{ requires: 'flag:ungranted' }, 'requires', 'nothing grants'],
    [{ rewards: ['read:missing'] }, 'rewards.0', 'no archives record'],
    [
      { questions: [{ ...trivia().questions[0], answer: 2 }] },
      'questions.0.answer',
      'zero-based index',
    ],
  ])('reports door errors with file and field for %j', (overrides, field, message) => {
    const error = firstError({ ...validFiles(), [DOOR_FILE]: { ...trivia(), ...overrides } });
    expect(error).toMatchObject({ file: DOOR_FILE, field });
    expect(error.message).toContain(message);
  });

  it('reports two JSON doors with a repeated ID', () => {
    const copy = 'content/doors/z.json';
    const error = firstError({ ...validFiles(), [copy]: trivia() });
    expect(error).toMatchObject({ file: copy, field: 'id' });
    expect(error.message).toContain(`first defined in ${DOOR_FILE}`);
  });

  it('validates code-door metadata and ID collisions without loading the lifecycle', () => {
    const code = {
      source: 'src/doors/optional.ts',
      metadata: DOOR_META,
      async load() {
        throw new Error('metadata validation must not load the door');
      },
    } satisfies CodeDoorRegistration;
    expect(loadContent(validFiles(), [code]).errors).toEqual([
      expect.objectContaining({
        file: code.source,
        field: 'id',
        message: expect.stringContaining(DOOR_FILE),
      }),
    ]);
    const invalid = { ...code, metadata: { ...DOOR_META, version: 0 } };
    expect(loadContent(validFiles(), [invalid]).errors).toEqual([
      expect.objectContaining({ file: code.source, field: 'version' }),
    ]);
  });

  it('resolves flags granted by both door types in board statuses and reports misspellings', () => {
    const files = validFiles();
    const boardFile = 'content/bbs/board.json';
    const code = {
      source: 'src/doors/optional.ts',
      metadata: { ...DOOR_META, id: 'optional', rewards: ['flag:optional-complete'] },
      async load() {
        throw new Error('metadata validation must not load the door');
      },
    } satisfies CodeDoorRegistration;
    const status = [
      { when: 'flag:quiz-complete', text: 'QUIZ COMPLETE' },
      { when: 'flag:optional-complete', text: 'OPTIONAL DRILL COMPLETE' },
    ];
    Object.assign(files[boardFile] as object, { status });
    const valid = loadContent(files, [code]);
    expect(valid.errors).toEqual([]);
    expect(valid.manifest.entries.map(({ id }) => id)).not.toContain('optional');
    status[1]!.when = 'flag:optional-complet';
    expect(loadContent(files, [code]).errors).toEqual([
      expect.objectContaining({
        file: boardFile,
        field: 'status.1.when',
        message: 'nothing grants "flag:optional-complet"',
      }),
    ]);
  });

  it.each([
    ['message', 'body', 'not a list', 'body', 'array'],
    ['message', 'board', 'post', 'board', 'unknown BBS board'],
    ['board', 'requires', 'completed:missing', 'requires', 'no episodes record'],
    ['board', 'archiveIds', ['missing'], 'archiveIds.0', 'unknown archive'],
    ['message', 'id', 'board', 'id', 'duplicate bbs id'],
  ])('reports BBS %s %s errors with file and field', (kind, key, value, field, message) => {
    const files = validFiles();
    const file = `content/bbs/${kind}.json`;
    files[file] = { ...(files[file] as Record<string, unknown>), [key]: value };
    const error = firstError(files);
    expect(error).toMatchObject({ file, field });
    expect(error.message).toContain(message);
  });

  it('validates the bundled BBS graph and retains archive defaults and inherited reviewed credit', () => {
    const { content, errors } = loadContent(readContentDir('content'));
    expect(errors).toEqual([]);
    expect(content.bbs.find(({ id }) => id === 'relay-note')).toMatchObject({
      origin: 'fictional',
      presentation: 'ai-fictional',
    });
    expect(content.archives.find(({ id }) => id === 'manual.rev-c')).toMatchObject({
      origin: 'fictional',
      presentation: 'recovered',
    });
    expect(content.archives.find(({ id }) => id === 'community.second-line')).toMatchObject({
      origin: 'reviewed-community',
      attribution: { author: 'SIGNAL//LOST maintainers' },
    });
    expect(loadContent(validFiles()).content.bbs.find(({ id }) => id === 'post')).toMatchObject({
      origin: 'fictional',
      presentation: 'history',
      board: 'board',
    });
  });

  it.each([
    [
      'relay-thread',
      'messages',
      [{ kind: 'message', id: 'missing' }],
      'messages.0.id',
      'unknown BBS message',
    ],
    [
      'relay-thread',
      'messages',
      [{ kind: 'message', id: 'general' }],
      'messages.0.id',
      'unknown BBS message',
    ],
    [
      'relay-thread',
      'messages',
      [{ kind: 'archive', id: 'missing' }],
      'messages.0.id',
      'unknown archive',
    ],
    [
      'relay-thread',
      'messages',
      [{ kind: 'archive', id: 'relay-note' }],
      'messages.0.id',
      'unknown archive',
    ],
    [
      'relay-thread',
      'messages',
      [{ kind: 'archive', id: 'bbs.keel' }],
      'messages.0.id',
      'search-only archives',
    ],
    [
      'second-line-thread',
      'messages',
      [{ kind: 'message', id: 'relay-note' }],
      'messages.0.id',
      'same board',
    ],
    [
      'relay-thread',
      'replies',
      [{ id: 'one', label: 'One', messageId: 'missing' }],
      'replies.0.messageId',
      'unknown BBS message',
    ],
    [
      'relay-thread',
      'replies',
      [{ id: 'one', label: 'One', messageId: 'general' }],
      'replies.0.messageId',
      'unknown BBS message',
    ],
    [
      'relay-thread',
      'replies',
      [{ id: 'one', label: 'One', messageId: 'relay-note' }],
      'replies.0.messageId',
      'public thread post',
    ],
    [
      'second-line-thread',
      'replies',
      [{ id: 'one', label: 'One', messageId: 'relay-receipt' }],
      'replies.0.messageId',
      'same board',
    ],
    [
      'relay-thread',
      'replies',
      [
        { id: 'one', label: 'One', messageId: 'relay-receipt' },
        { id: 'one', label: 'Two', messageId: 'relay-deferred' },
      ],
      'replies.1.id',
      'duplicate reply',
    ],
    ['echo-profile', 'characterId', 'missing', 'characterId', 'unknown character'],
    ['echo-profile', 'characterId', 'general', 'characterId', 'unknown character'],
    ['echo-profile', 'bbs', 'general', 'bbs', 'unknown BBS endpoint'],
    ['linecheck', 'clueMessageId', 'relay-receipt', 'clueMessageId', 'public thread clue'],
    ['linecheck', 'clueMessageId', 'community.second-line', 'clueMessageId', 'public thread clue'],
    ['linecheck', 'command', 'hElP', 'command', 'reserved or duplicate'],
  ])('rejects invalid BBS %s %s references', (record, key, value, field, message) => {
    const files = readContentDir('content');
    const file = `content/bbs/${record}.json`;
    files[file] = { ...(files[file] as Record<string, unknown>), [key]: value };
    expect(loadContent(files).errors).toContainEqual({
      file,
      field,
      message: expect.stringContaining(message),
    });
  });

  it('rejects case-insensitive duplicate hidden commands on the same endpoint', () => {
    const files = readContentDir('content');
    const file = 'content/bbs/zz-collision.json';
    files[file] = {
      ...(files['content/bbs/linecheck.json'] as Record<string, unknown>),
      id: 'another-secret',
      command: 'lineCHECK',
    };
    expect(loadContent(files).errors).toContainEqual({
      file,
      field: 'command',
      message: expect.stringContaining('duplicate'),
    });
  });

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

  const withFailures = (failures: unknown) => {
    const files = validFiles();
    const character = files['content/characters/echo.json'] as {
      lines: Record<string, unknown>[];
    };
    character.lines[0]!['failures'] = failures;
    return files;
  };

  it('accepts a valid dialogue failure requirement', () => {
    expect(loadContent(withFailures({ puzzle: 'p.code', atLeast: 2 })).errors).toEqual([]);
  });

  it.each([{ puzzle: 'p.code', atLeast: 0 }, { puzzle: 'p.code' }, { atLeast: 1 }, 'p.code'])(
    'rejects the malformed dialogue failure requirement %j',
    (failures) => {
      expect(firstError(withFailures(failures)).field).toContain('lines.0.failures');
    },
  );

  it('reports a dialogue failure requirement naming an unknown puzzle', () => {
    expect(firstError(withFailures({ puzzle: 'ghost', atLeast: 1 }))).toMatchObject({
      file: 'content/characters/echo.json',
      field: 'lines.0.failures.puzzle',
    });
  });

  it('accepts a sector linked to a puzzle and an action', () => {
    const files = validFiles();
    Object.assign(files['content/sectors/s.json'] as object, {
      puzzle: 'p.code',
      opens: 'archive',
    });
    expect(loadContent(files).errors).toEqual([]);
  });

  it('reports a sector linked to an unknown puzzle', () => {
    const files = validFiles();
    Object.assign(files['content/sectors/s.json'] as object, { puzzle: 'ghost' });
    expect(firstError(files)).toMatchObject({ file: 'content/sectors/s.json', field: 'puzzle' });
  });

  it('reports an artifact granting a fact about an unknown record', () => {
    const files = validFiles();
    Object.assign(files['content/artifacts/a.json'] as object, { grantsOnOpen: ['read:ghost'] });
    expect(firstError(files)).toMatchObject({
      file: 'content/artifacts/a.json',
      field: 'grantsOnOpen.0',
    });
  });

  it('reports files outside known directories', () => {
    expect(firstError({ 'content/mystery/x.json': {} }).field).toBe('(file)');
  });
});

describe('network event and BBS dialogue references', () => {
  const producerFile = 'content/events/producer.json';
  const consumerFile = 'content/events/consumer.json';
  const boardFile = 'content/bbs/board.json';
  const bulletinFile = 'content/bbs/bulletin.json';
  const characterFile = 'content/characters/sysop.json';
  const producer = {
    id: 'producer',
    when: 'bbs-read:post',
    effects: [{ kind: 'grant-flag', flag: 'receipt' }],
  };
  const consumer = {
    id: 'consumer',
    when: 'flag:receipt',
    effects: [{ kind: 'post-bulletin', messageId: 'bulletin' }],
  };
  const greeting = { id: 'sysop.greeting', kind: 'bbs', text: ['Hello'] };
  const followUp = { id: 'sysop.receipt', kind: 'bbs', text: ['Filed'], when: 'flag:receipt' };

  function filesWithEvents(): Record<string, unknown> {
    const files = validFiles();
    Object.assign(files[boardFile] as object, {
      status: [{ when: 'flag:receipt', text: 'Receipt filed' }],
      sysopCharacterId: 'sysop',
    });
    return {
      ...files,
      [producerFile]: producer,
      [consumerFile]: consumer,
      [bulletinFile]: {
        kind: 'message',
        id: 'bulletin',
        board: 'board',
        title: 'Bulletin',
        from: 'SYSOP',
        date: 'UNDATED',
        body: ['Filed'],
        eventOnly: true,
      },
      [characterFile]: { id: 'sysop', name: 'SYSOP', lines: [greeting, followUp] },
    };
  }

  it('includes events in the manifest and recognizes their flags across all conditions', () => {
    const files = filesWithEvents();
    const { errors, manifest } = loadContent(files);
    expect(errors).toEqual([]);
    expect(manifest.entries).toContainEqual({ kind: 'events', id: 'producer', file: producerFile });
    delete files[producerFile];
    expect(loadContent(files).errors).toEqual(
      expect.arrayContaining(
        [
          [consumerFile, 'when'],
          [boardFile, 'status.0.when'],
          [characterFile, 'lines.1.when'],
        ].map(([file, field]) => ({ file, field, message: 'nothing grants "flag:receipt"' })),
      ),
    );
  });

  it.each(['missing', 'board', 'post'])('rejects invalid bulletin target %s', (messageId) => {
    const files = filesWithEvents();
    files[consumerFile] = { ...consumer, effects: [{ kind: 'post-bulletin', messageId }] };
    expect(firstError(files)).toEqual({
      file: consumerFile,
      field: 'effects.0.messageId',
      message:
        messageId === 'post'
          ? 'bulletin message must set eventOnly'
          : `unknown BBS message "${messageId}"`,
    });
  });

  it('requires an event-only message to belong directly to an endpoint', () => {
    const files = filesWithEvents();
    files['content/bbs/room.json'] = {
      kind: 'message-board',
      id: 'room',
      bbs: 'board',
      title: 'Room',
      description: [],
    };
    files[bulletinFile] = { ...(files[bulletinFile] as object), board: 'room' };
    expect(firstError(files)).toEqual({
      file: bulletinFile,
      field: 'board',
      message: 'an event bulletin must belong to a BBS endpoint',
    });
  });

  it.each([
    ['solved:missing', 'unknown fact "solved:missing": no puzzles record has id "missing"'],
    ['bbs-read:missing', 'unknown BBS message "missing"'],
    ['bbs-read:board', 'unknown BBS message "board"'],
  ])('rejects unknown event condition %s', (when, message) => {
    const files = filesWithEvents();
    files[producerFile] = { ...producer, when };
    expect(firstError(files)).toMatchObject({ file: producerFile, field: 'when', message });
  });

  it('allows a BBS read in conditions only', () => {
    const files = filesWithEvents();
    Object.assign(files['content/episodes/e.json'] as object, { grants: ['bbs-read:post'] });
    expect(firstError(files)).toMatchObject({ file: 'content/episodes/e.json', field: 'grants.0' });
  });

  it('checks SYSOP references and requires a baseline BBS line', () => {
    const files = filesWithEvents();
    Object.assign(files[boardFile] as object, { sysopCharacterId: 'missing' });
    expect(firstError(files)).toEqual({
      file: boardFile,
      field: 'sysopCharacterId',
      message: 'unknown character "missing"',
    });
    Object.assign(files[boardFile] as object, { sysopCharacterId: 'sysop' });
    for (const line of [
      { ...greeting, once: true },
      { ...greeting, when: 'flag:receipt' },
    ]) {
      files[characterFile] = { ...(files[characterFile] as object), lines: [line] };
      expect(firstError(files)).toEqual({
        file: boardFile,
        field: 'sysopCharacterId',
        message: 'SYSOP needs a repeatable, unconditional BBS line',
      });
    }
  });

  it('reports invalid dialogue references and cross-character line IDs', () => {
    const files = filesWithEvents();
    files[characterFile] = {
      ...(files[characterFile] as object),
      lines: [
        greeting,
        { ...followUp, id: 'l', when: 'bbs-read:missing' },
        { ...followUp, failures: { puzzle: 'missing', atLeast: 1 } },
      ],
    };
    expect(loadContent(files).errors).toEqual([
      {
        file: characterFile,
        field: 'lines.1.id',
        message: 'duplicate dialogue line id "l" (first defined in content/characters/echo.json)',
      },
      { file: characterFile, field: 'lines.1.when', message: 'unknown BBS message "missing"' },
      {
        file: characterFile,
        field: 'lines.2.failures.puzzle',
        message: 'unknown puzzle "missing"',
      },
    ]);
  });

  it('rejects an event depending on its own effect', () => {
    const files = filesWithEvents();
    files[producerFile] = { ...producer, when: 'flag:receipt' };
    expect(firstError(files)).toEqual({
      file: producerFile,
      field: 'when',
      message: 'event dependency cycle: producer -> producer',
    });
  });

  it('rejects a two-event cycle through nested and negated conditions', () => {
    const files = filesWithEvents();
    files[producerFile] = { ...producer, when: { any: ['bbs-read:post', { not: 'flag:other' }] } };
    files[consumerFile] = {
      ...consumer,
      when: { all: ['completed:e', 'flag:receipt'] },
      effects: [{ kind: 'grant-flag', flag: 'other' }],
    };
    expect(firstError(files)).toEqual({
      file: consumerFile,
      field: 'when',
      message: 'event dependency cycle: consumer -> producer -> consumer',
    });
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

  it('the CLI exits 1 and names a bad door answer field', () => {
    const root = tree('t.json', { id: 't', title: 'T', body: [] });
    mkdirSync(join(root, 'doors'));
    const door = trivia();
    door.questions[0]!.answer = 99;
    writeFileSync(join(root, 'doors/test.json'), JSON.stringify(door));
    const result = cli(root);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${DOOR_FILE}: questions.0.answer:`);
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
