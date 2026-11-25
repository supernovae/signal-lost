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
import { afterEach, assert, describe, expect, it } from 'vitest';
import { contentPlugin } from '../../scripts/content-plugin.ts';
import { getBbsOffer } from '../../src/bbs/bbs.ts';
import { createBbsDoorSession } from '../../src/bbs/door-session.ts';
import { evaluate } from '../../src/content/conditions.ts';
import { hashContent } from '../../src/content/manifest.ts';
import { readContentDir } from '../../src/content/node.ts';
import {
  adventureDoorSchema,
  bbsBoardSchema,
  bbsInterfaceSchema,
  bbsMessageBoardSchema,
  characterSchema,
  communitySchema,
  type AdventureDoor,
  type Content,
  type DoorMetadata,
  type TriviaDoor,
} from '../../src/content/schema.ts';
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
    grants: ['flag:ended', 'flag:spool-02-restored'],
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

describe('adventure references', () => {
  const file = 'content/doors/forgotten-archive.json';
  const files = readContentDir('content');
  const cases: [string, string, (door: AdventureDoor) => void][] = [
    [
      'startLocationId',
      'missing-start',
      (door) => {
        door.startLocationId = 'missing-start';
      },
    ],
    [
      'locations.0.actions.0.toLocationId',
      'missing-destination',
      (door) => {
        Object.assign(door.locations[0]!.actions[0]!, { toLocationId: 'missing-destination' });
      },
    ],
    [
      'locations.1.actions.0.itemId',
      'missing-fragment',
      (door) => {
        Object.assign(door.locations[1]!.actions[0]!, { itemId: 'missing-fragment' });
      },
    ],
    [
      'orderPuzzles.0.requiredItemIds.0',
      'missing-required-item',
      (door) => {
        door.orderPuzzles[0]!.requiredItemIds[0] = 'missing-required-item';
      },
    ],
    [
      'locations.0.actions.1.when.all.1.not',
      'flag:missing-local-flag',
      (door) => {
        door.locations[0]!.actions[1]!.when = {
          all: ['flag:order-learned', { not: 'flag:missing-local-flag' }],
        };
      },
    ],
    [
      'orderPuzzles.0.successFlag',
      'missing-success',
      (door) => {
        door.orderPuzzles[0]!.successFlag = 'missing-success';
      },
    ],
    [
      'locations.2.id',
      'comparison-desk',
      (door) => {
        door.locations[0]!.actions[1]!.when = {
          all: ['flag:order-learned', { not: 'flag:order-learned' }],
        };
      },
    ],
    [
      'rewardRules.0.reward',
      'flag:undeclared-reward',
      (door) => {
        door.rewardRules[0]!.reward = 'flag:undeclared-reward';
      },
    ],
    [
      'rewards.0',
      'flag:spool-02-order-learned',
      (door) => {
        door.rewardRules.shift();
      },
    ],
    [
      'orderPuzzles.0.operations.1.inputs.0.token',
      'missing-token',
      (door) => {
        door.orderPuzzles[0]!.operations[1]!.inputs[0]!.token = 'missing-token';
      },
    ],
    [
      'locations.1.actions.3.operationIds.2',
      'route',
      (door) => {
        Object.assign(door.locations[1]!.actions[3]!, { operationIds: ['route', 'ack', 'route'] });
      },
    ],
    [
      'locations.1.actions.3.puzzleId',
      'missing-puzzle',
      (door) => {
        Object.assign(door.locations[1]!.actions[3]!, { puzzleId: 'missing-puzzle' });
      },
    ],
    [
      'locations.1.actions.3.operationIds.2',
      'missing-operation',
      (door) => {
        Object.assign(door.locations[1]!.actions[3]!, {
          operationIds: ['route', 'ack', 'missing-operation'],
        });
      },
    ],
    [
      'locations.3.actions.2.endingId',
      'missing-ending',
      (door) => {
        Object.assign(door.locations[3]!.actions[2]!, { endingId: 'missing-ending' });
      },
    ],
    [
      'locations.2.actions.1.variants.1.when',
      'unconditional',
      (door) => {
        const action = door.locations[2]!.actions[1]!;
        if (action.kind !== 'talk') throw new Error('Expected dialogue');
        action.variants[1]!.when = 'read:copy-scope';
      },
    ],
    [
      'locations.0.actions.1.command',
      'EXIT',
      (door) => {
        door.locations[0]!.actions[1]!.command = ' exit  ';
      },
    ],
    [
      'locations.1.actions.4.command',
      'ROUTE / ACK / SEAL',
      (door) => {
        door.locations[1]!.actions[4]!.command = ' route/ack  /  seal ';
      },
    ],
    [
      'items.5.id',
      'seal-fragment',
      (door) => {
        door.items.push(door.items[0]!);
      },
    ],
  ];

  it.each(cases)('reports %s with %s', (field, id, mutate) => {
    const door = adventureDoorSchema.parse(files[file]);
    mutate(door);
    expect(loadContent({ ...files, [file]: door }).errors).toContainEqual({
      file,
      field,
      message: expect.stringContaining(id),
    });
  });

  it('bounds state enumeration and reports the affected door and field', () => {
    const door = adventureDoorSchema.parse(files[file]);
    for (let i = 0; i < 13; i++) {
      const id = `optional-${i}`;
      door.items.push({ id, text: ['Optional note'] });
      door.locations[0]!.actions.push({
        kind: 'inspect',
        command: `READ ${i}`,
        label: id,
        itemId: id,
      });
    }
    expect(loadContent({ ...files, [file]: door }).errors).toEqual([
      { file, field: 'locations', message: 'adventure exceeds 4096 reachable states' },
    ]);
  });
});

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
    ['linecheck', 'command', 'sEaRcH', 'command', 'reserved or duplicate'],
    ['linecheck', 'command', 'sUbMiT', 'command', 'reserved or duplicate'],
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

describe('access and capability diagnostics', () => {
  const files = readContentDir('content');
  const baselineFile = 'content/access-levels/visitor.json';
  const relayFile = 'content/access-levels/relay.json';
  const boardFile = 'content/bbs/second-line.json';
  const researchFile = 'content/capabilities/service-panel-research.json';
  const reputationFile = 'content/capabilities/relay-desk-reputation.json';
  const communityFile = 'content/community/first-light.json';
  const sysopFile = 'content/characters/sysop.json';
  const endpointFile = 'content/bbs/deep-field.json';
  const panel = 'flag:service-panel-open';
  const reputation = 'flag:relay-note-read';
  const relay = { id: 'relay', label: 'RELAY', rank: 1, when: panel };
  const research = { id: 'service-panel-research', kind: 'research', fact: panel };
  const board = bbsMessageBoardSchema.parse(files[boardFile]);

  function expectError(
    overrides: Record<string, unknown>,
    file: string,
    field: string,
    message?: string,
  ) {
    const errors = loadContent({ ...files, ...overrides }).errors;
    expect(errors).toContainEqual(
      expect.objectContaining({
        file,
        field,
        ...(message ? { message: expect.stringContaining(message) } : {}),
      }),
    );
  }

  it.each([
    [{ all: [panel, { any: [{ not: 'flag:relay-trivia-complete' }] }] }, 'when'],
    [{ all: [] }, 'when.all'],
    [{ any: [] }, 'when.any'],
  ])('rejects invalid access condition %j', (when, field) => {
    expectError({ [relayFile]: { ...relay, when } }, relayFile, field);
  });

  it('requires the unconditional baseline and a condition at every positive rank', () => {
    const withoutBaseline = { ...files };
    delete withoutBaseline[baselineFile];
    expect(loadContent(withoutBaseline).errors).toContainEqual(
      expect.objectContaining({
        file: expect.stringMatching(/^content\/access-levels\//),
        field: 'rank',
        message: expect.stringContaining('unconditional rank 0'),
      }),
    );
    expectError(
      { [baselineFile]: { ...relay, id: 'visitor', rank: 0 } },
      baselineFile,
      'when',
      'unconditional',
    );
    expectError(
      { [relayFile]: { ...relay, when: undefined } },
      relayFile,
      'when',
      'positive ranks',
    );
    expectError({ [relayFile]: { ...relay, rank: -1 } }, relayFile, 'rank');
  });

  it('rejects duplicate ranks and IDs, unknown facts and unknown board thresholds', () => {
    const extraFile = 'content/access-levels/z-extra.json';
    expectError(
      { [extraFile]: { ...relay, id: 'extra' } },
      extraFile,
      'rank',
      'duplicate access level rank',
    );
    expectError(
      { [extraFile]: { ...relay, rank: 3 } },
      extraFile,
      'id',
      'duplicate accessLevels id',
    );
    expectError(
      { [relayFile]: { ...relay, when: 'solved:p.missing' } },
      relayFile,
      'when',
      'unknown fact',
    );
    expectError(
      { [boardFile]: { ...board, access: { ...board.access, level: 'missing' } } },
      boardFile,
      'access.level',
      'unknown access level',
    );
  });

  it('requires research to make the declared archive available', () => {
    const community = communitySchema.parse(files[communityFile]);
    const archive = community.archives[0]!;
    const requires = { all: [panel, 'completed:episode.000'] };
    const target = { kind: 'archive', id: archive.id };
    const withCondition = { ...community, archives: [{ ...archive, requires }] };
    expect(
      loadContent({
        ...files,
        [communityFile]: withCondition,
        [researchFile]: {
          ...research,
          target,
          context: ['completed:episode.000'],
        },
      }).errors,
    ).toEqual([]);
    expectError(
      { [researchFile]: { ...research, target: { ...target, id: 'missing' } } },
      researchFile,
      'target',
      'unknown archive',
    );
    expectError(
      { [communityFile]: { ...community, archives: [{ ...archive, requires: undefined }] } },
      researchFile,
      'target',
      'must unlock archive',
    );
    expectError({ [communityFile]: withCondition }, researchFile, 'target', 'must unlock archive');
  });

  it('requires a board-target research fact to raise access across its threshold', () => {
    const declaration = { ...research, target: { kind: 'board', id: board.id } };
    expect(loadContent({ ...files, [researchFile]: declaration }).errors).toEqual([]);
    const hidden = { ...board, requires: 'completed:episode.000' };
    expectError(
      { [researchFile]: declaration, [boardFile]: hidden },
      researchFile,
      'target',
      'must unlock BBS message board',
    );
    expect(
      loadContent({
        ...files,
        [researchFile]: { ...declaration, context: ['completed:episode.000'] },
        [boardFile]: hidden,
      }).errors,
    ).toEqual([]);
    expectError(
      {
        [researchFile]: declaration,
        [boardFile]: { ...board, access: { ...board.access, level: 'visitor' } },
      },
      researchFile,
      'target',
      'must unlock BBS message board',
    );
    expectError(
      {
        [researchFile]: declaration,
        [relayFile]: { ...relay, when: 'flag:relay-trivia-complete' },
      },
      researchFile,
      'target',
      'must unlock BBS message board',
    );
    expectError(
      { [researchFile]: { ...declaration, target: { kind: 'board', id: 'missing' } } },
      researchFile,
      'target',
      'unknown BBS message board',
    );
    expectError(
      { [researchFile]: { ...declaration, fact: 'flag:missing' } },
      researchFile,
      'fact',
      'nothing grants',
    );
    expectError(
      { [researchFile]: { ...declaration, context: ['bbs-read:missing'] } },
      researchFile,
      'context.0',
      'unknown BBS message',
    );
    expectError(
      { [researchFile]: { ...declaration, context: [panel] } },
      researchFile,
      'context',
      'cannot contain',
    );
  });

  it('requires reputation to select the advertised response and change its visible text', () => {
    const sysop = characterSchema.parse(files[sysopFile]);
    const [greeting, earned] = sysop.lines;
    const endpoint = bbsBoardSchema.parse(files[endpointFile]);
    expect(loadContent(files).errors).toEqual([]);
    const cases = [
      { [sysopFile]: { ...sysop, lines: [greeting, { ...earned, when: undefined }] } },
      {
        [endpointFile]: {
          ...endpoint,
          status: [...endpoint.status, { when: reputation, text: 'FILED' }],
        },
        [sysopFile]: { ...sysop, lines: [greeting, { ...earned, when: panel }] },
      },
      { [sysopFile]: { ...sysop, lines: [{ ...greeting, priority: 2 }, earned] } },
      { [sysopFile]: { ...sysop, lines: [greeting, { ...earned, text: greeting!.text }] } },
    ];
    for (const overrides of cases) {
      expectError(
        overrides,
        reputationFile,
        'target',
        'must select a different visible BBS response',
      );
    }
    expectError(
      {
        [reputationFile]: {
          id: 'test',
          kind: 'reputation',
          fact: reputation,
          target: { characterId: sysop.id, lineId: 'missing' },
        },
      },
      reputationFile,
      'target',
      'unknown or unreachable BBS response',
    );
  });

  it('rejects a TALK reward that repeats the no-response text', () => {
    const echoFile = 'content/characters/echo.json';
    const echo = characterSchema.parse(files[echoFile]);
    const copy = bbsInterfaceSchema.parse(files['content/bbs/interface.json']);
    const lineId = 'echo.bbs.test-receipt';
    expectError(
      {
        [echoFile]: {
          ...echo,
          lines: [{ id: lineId, kind: 'bbs', when: reputation, text: [copy.text.noDialogue] }],
        },
        [reputationFile]: {
          id: 'test',
          kind: 'reputation',
          fact: reputation,
          target: { characterId: echo.id, lineId },
        },
      },
      reputationFile,
      'target',
      'must select a different visible BBS response',
    );
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
    const root = tree('t.json', { id: 't', title: 'T', body: [] });
    mkdirSync(join(root, 'events'));
    writeFileSync(
      join(root, 'events/fixture-restore.json'),
      JSON.stringify({
        id: 'fixture-restore',
        when: 'acquired:t',
        effects: [{ kind: 'grant-flag', flag: 'spool-02-restored' }],
      }),
    );
    const result = cli(root);
    expect(result.status).toBe(0);
    expect(result.output).toContain('Content OK: 2 records');
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

  it('the build supplies all validated browser content and its manifest', async () => {
    const expected = loadContent(readContentDir('content'));
    expect(expected.errors).toEqual([]);
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [contentPlugin()],
      build: { write: false, lib: { entry: 'src/content/browser.ts', formats: ['es'] } },
    });
    const builds = Array.isArray(result) ? result : [result];
    expect(builds).toHaveLength(1);
    const [bundle] = builds;
    assert(bundle && 'output' in bundle, 'Expected an in-memory bundle');
    const entry = bundle.output.find((file) => file.type === 'chunk' && file.isEntry);
    assert(entry?.type === 'chunk', 'Expected a JavaScript entry');
    expect(entry.imports).toEqual([]);
    expect(entry.dynamicImports).toEqual([]);
    const url = `data:text/javascript;base64,${Buffer.from(entry.code).toString('base64')}`;
    const bundled: { loadBundledContent(): Content } = await import(/* @vite-ignore */ url);
    const content = bundled.loadBundledContent();
    expect(content).toStrictEqual(expected.content);
    const doorIds = content.doors.map((door) => door.id);
    expect(doorIds).toContain('forgotten-archive');
    expect(doorIds).not.toContain('tiny-adventure');

    const manifest = bundle.output.find((file) => file.fileName === 'content-manifest.json');
    assert(
      manifest?.type === 'asset' && typeof manifest.source === 'string',
      'Expected a manifest',
    );
    expect(JSON.parse(manifest.source)).toStrictEqual(expected.manifest);
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

describe('declarative BBS board checks', () => {
  const boardFile = 'content/bbs/q17-header-desk.json';
  const resultFile = 'content/bbs/q17-header-confirmation.json';
  const eventFile = 'content/events/q17-header-confirmation.json';
  const otherEndpoint = 'content/bbs/other-endpoint.json';
  const pendingFiles = readContentDir('content');
  const board = bbsMessageBoardSchema.parse(pendingFiles[boardFile]);
  const check = board.check!;
  const result = pendingFiles[resultFile] as Record<string, unknown>;
  const event = pendingFiles[eventFile] as Record<string, unknown>;
  const endpoint = {
    ...bbsBoardSchema.parse(pendingFiles['content/bbs/deep-field.json']),
    id: 'other-endpoint',
  };

  function boardError(overrides: Record<string, unknown>, field: string, message: string) {
    expect(loadContent({ ...pendingFiles, ...overrides }).errors).toContainEqual({
      file: boardFile,
      field,
      message: expect.stringContaining(message),
    });
  }

  it('resolves a board visibility requirement', () => {
    boardError(
      { [boardFile]: { ...board, requires: 'flag:unknown-board-gate' } },
      'requires',
      'nothing grants',
    );
  });

  it.each([
    { evidence: [], field: 'check.evidenceMessageIds', message: 'Too small' },
    {
      evidence: ['q17-headers', 'q17-headers'],
      field: 'check.evidenceMessageIds',
      message: 'must be unique',
    },
    { evidence: ['missing'], field: 'check.evidenceMessageIds.0', message: 'unknown BBS message' },
    { evidence: ['general'], field: 'check.evidenceMessageIds.0', message: 'unknown BBS message' },
    {
      evidence: ['relay-receipt'],
      field: 'check.evidenceMessageIds.0',
      message: 'public thread message',
    },
    {
      evidence: ['q17-header-confirmation'],
      field: 'check.evidenceMessageIds.0',
      message: 'public thread message',
    },
  ])('rejects invalid evidence $evidence at $field', ({ evidence, field, message }) => {
    boardError(
      { [boardFile]: { ...board, check: { ...check, evidenceMessageIds: evidence } } },
      field,
      message,
    );
  });

  it.each(['', ' ', 'TWO TOKENS'])('rejects invalid answer token %j', (answer) => {
    boardError(
      { [boardFile]: { ...board, check: { ...check, answer } } },
      'check.answer',
      'one nonblank answer token',
    );
  });

  it('requires evidence from the same endpoint even when the post is public', () => {
    const ledger = 'content/bbs/forgotten-board.json';
    const owner = bbsMessageBoardSchema.parse(pendingFiles[ledger]);
    boardError(
      { [otherEndpoint]: endpoint, [ledger]: { ...owner, bbs: endpoint.id } },
      'check.evidenceMessageIds.0',
      'public thread message on this endpoint',
    );
  });

  it.each([{ response: 'q17-headers' }, { response: 'missing' }])(
    'rejects $response as a check result',
    ({ response }) => {
      boardError(
        { [boardFile]: { ...board, check: { ...check, responseMessageId: response } } },
        'check.responseMessageId',
        'event-only message on this endpoint',
      );
    },
  );

  it('rejects a result owned by another endpoint', () => {
    boardError(
      { [otherEndpoint]: endpoint, [resultFile]: { ...result, board: endpoint.id } },
      'check.responseMessageId',
      'event-only message on this endpoint',
    );
  });

  it('rejects a result reused by another board check', () => {
    boardError(
      { 'content/bbs/another-desk.json': { ...board, id: 'another-desk' } },
      'check.responseMessageId',
      'exactly one board check',
    );
  });

  it.each([
    { event: { ...event, when: 'flag:deferred-batch-located' }, name: 'an early publication' },
    {
      event: { ...event, when: { any: [event['when'], 'flag:deferred-batch-located'] } },
      name: 'an alternate trigger',
    },
    {
      event: { ...event, effects: [{ kind: 'grant-flag', flag: 'deferred-headers-verified' }] },
      name: 'a missing publication',
    },
  ])('rejects $name of the response', ({ event: malformed }) => {
    boardError(
      { [eventFile]: malformed },
      'check.responseMessageId',
      'one bulletin posting triggered by its own BBS read',
    );
  });

  it('rejects a second event posting the same response', () => {
    boardError(
      {
        'content/events/early-copy.json': {
          ...event,
          id: 'early-copy',
          when: 'flag:deferred-batch-located',
        },
      },
      'check.responseMessageId',
      'one bulletin posting triggered by its own BBS read',
    );
  });
});

describe('declarative BBS order checks', () => {
  const files = readContentDir('content');
  const boardFile = 'content/bbs/spool-02-recovery.json';
  const receiptFile = 'content/bbs/spool-02-restoration-receipt.json';
  const eventFile = 'content/events/spool-02-restored.json';
  const board = bbsMessageBoardSchema.parse(files[boardFile]);
  const check = board.orderCheck!;
  const { responseMessageId } = check;
  const event = files[eventFile] as { id: string; when: string; effects: { kind: string }[] };
  const earlierCheck = bbsMessageBoardSchema.parse(files['content/bbs/q17-header-desk.json']);

  function boardError(overrides: Record<string, unknown>, field: string, message: string) {
    expect(loadContent({ ...files, ...overrides }).errors).toContainEqual({
      file: boardFile,
      field,
      message: expect.stringContaining(message),
    });
  }

  it('validates the shipped receipt and its only restore flag producer', () => {
    const { errors, content } = loadContent(files);
    expect(errors).toEqual([]);
    expect(content.bbs.find(({ id }) => id === responseMessageId)).toMatchObject({
      kind: 'message',
      board: board.bbs,
      eventOnly: true,
    });
    const owners = content.bbs.filter(
      (entry) =>
        entry.kind === 'message-board' &&
        (entry.check ?? entry.orderCheck)?.responseMessageId === responseMessageId,
    );
    expect(owners.map(({ id }) => id)).toEqual([board.id]);
    const producers = content.events.filter(({ effects }) =>
      effects.some((effect) => effect.kind === 'grant-flag' && effect.flag === 'spool-02-restored'),
    );
    expect(producers).toEqual([
      {
        id: 'spool-02-restored',
        when: `bbs-read:${responseMessageId}`,
        effects: [
          { kind: 'grant-flag', flag: 'spool-02-restored' },
          { kind: 'post-bulletin', messageId: responseMessageId },
        ],
      },
    ]);
    const missing = loadContent({
      ...files,
      [eventFile]: { ...event, effects: event.effects.filter(({ kind }) => kind !== 'grant-flag') },
    });
    for (const [file, field] of [
      ['content/bbs/maintenance-annex.json', 'requires'],
      ['content/access-levels/maintainer.json', 'when'],
      ['content/sectors/spool-02.json', 'visibleWhen'],
      ['src/doors/signal-hunter/signal-hunter.ts', 'requires'],
    ]) {
      expect(missing.errors).toContainEqual({
        file,
        field,
        message: 'nothing grants "flag:spool-02-restored"',
      });
    }
  });

  it('rejects a board with both check modes', () => {
    boardError(
      { [boardFile]: { ...board, check: earlierCheck.check } },
      'orderCheck',
      'only one check',
    );
  });

  it('rejects unknown and repeated prerequisites', () => {
    const [proof, learned] = check.prerequisites;
    boardError(
      {
        [boardFile]: {
          ...board,
          orderCheck: {
            ...check,
            prerequisites: [{ ...proof, fact: 'flag:missing-proof' }, learned],
          },
        },
      },
      'orderCheck.prerequisites.0.fact',
      'nothing grants "flag:missing-proof"',
    );
    boardError(
      { [boardFile]: { ...board, orderCheck: { ...check, prerequisites: [proof, proof] } } },
      'orderCheck.prerequisites',
      'prerequisite facts must be unique',
    );
  });

  it('rejects malformed and repeated operation tokens', () => {
    const [operation] = check.operations;
    boardError(
      {
        [boardFile]: {
          ...board,
          orderCheck: {
            ...check,
            operations: [{ ...operation, token: 'seal / route' }, ...check.operations.slice(1)],
          },
        },
      },
      'orderCheck.operations.0.token',
      'Invalid string',
    );
    boardError(
      { [boardFile]: { ...board, orderCheck: { ...check, operations: [operation, operation] } } },
      'orderCheck.operations',
      'operations must be unique',
    );
  });

  it('rejects a non-event receipt or one claimed by another check mode', () => {
    const receipt = files[receiptFile] as Record<string, unknown>;
    boardError(
      { [receiptFile]: { ...receipt, eventOnly: false } },
      'orderCheck.responseMessageId',
      'event-only message on this endpoint',
    );
    boardError(
      {
        'content/bbs/q17-header-desk.json': {
          ...earlierCheck,
          check: {
            ...earlierCheck.check,
            responseMessageId,
          },
        },
      },
      'orderCheck.responseMessageId',
      'exactly one board check',
    );
  });

  it('rejects early or duplicate receipt publication', () => {
    const beforeReceipt = 'flag:deferred-verified';
    for (const overrides of [
      { [eventFile]: { ...event, when: beforeReceipt } },
      {
        'content/events/early-restore-receipt.json': {
          id: 'early-restore-receipt',
          when: beforeReceipt,
          effects: [{ kind: 'post-bulletin', messageId: responseMessageId }],
        },
      },
    ]) {
      boardError(
        overrides,
        'orderCheck.responseMessageId',
        'one bulletin posting triggered by its own BBS read',
      );
    }
  });

  it.each(['ORDER', 'CLEAR', 'APPLY'])('reserves %s for ordered checks', (command) => {
    const file = 'content/bbs/linecheck.json';
    const secret = files[file] as Record<string, unknown>;
    expect(loadContent({ ...files, [file]: { ...secret, command } }).errors).toContainEqual({
      file,
      field: 'command',
      message: `reserved or duplicate BBS command "${command}"`,
    });
  });
});
