import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  addFact,
  DEFAULT_PREFERENCES,
  factsOf,
  freshSave,
  loadSave,
  openSaveSession,
  writeSave,
  type SaveStorage,
} from '../../src/progress/save.ts';

function memoryStorage(initial?: string) {
  let value: string | null = initial ?? null;
  return {
    get value() {
      return value;
    },
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, text: string) => {
      value = text;
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
}

const seed = () => 123;
const completedV1 = readFileSync(
  new URL('../fixtures/episode-000-complete-v1.json', import.meta.url),
  'utf8',
);

describe('save data', () => {
  it('round-trips progress and normalizes the profile', () => {
    const storage = memoryStorage();
    const data = freshSave(0);
    addFact(data, 'solved:p');
    data.preferences = { muted: true, reducedMotion: true, effects: false };
    const handle = 'a'.repeat(31) + '🚀';
    data.profile = {
      handle: `  ${handle}z  `,
      designation: 'OBS-0001',
      accessLevel: 'MAINTAINER',
      seed: 0,
    };
    expect(writeSave(storage, data)).toBe(true);
    const draw = vi.fn(seed);
    expect(openSaveSession(storage, draw)).toMatchObject({
      status: 'loaded',
      data: { ...data, profile: { ...data.profile, handle } },
    });
    expect(draw).not.toHaveBeenCalled();
    expect(storage.setItem).toHaveBeenCalledOnce();

    data.profile.handle = ' \t ';
    expect(writeSave(storage, data)).toBe(true);
    expect(loadSave(storage).data.profile.handle).toBeNull();
  });

  it('creates and persists one seed when opening an empty store', () => {
    const storage = memoryStorage();
    const draw = vi.fn(seed);
    expect(loadSave(storage, seed).status).toBe('new');
    expect(openSaveSession(storage, draw)).toMatchObject({ status: 'new', data: freshSave(123) });
    expect(openSaveSession(storage, draw)).toMatchObject({
      status: 'loaded',
      data: freshSave(123),
    });
    expect(draw).toHaveBeenCalledOnce();
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it.each([
    ['invalid JSON', '{ nope'],
    ['the wrong global shape', '{"schemaVersion":1,"puzzles":"oops"}'],
    ['a non-object', '7'],
    ['a string version', '{"schemaVersion":"99"}'],
    ['a fractional version', '{"schemaVersion":2.5}'],
  ])('resets gracefully on %s', (_name, text) => {
    const storage = memoryStorage(text);
    expect(openSaveSession(storage, seed)).toMatchObject({
      status: 'reset',
      data: freshSave(123),
    });
    expect(loadSave(storage)).toEqual({ status: 'loaded', data: freshSave(123) });
  });

  it('migrates the completed Episode 000 v1 fixture without losing progress', () => {
    const { schemaVersion, designation, ...global } = JSON.parse(completedV1);
    expect(schemaVersion).toBe(1);
    expect(designation).toMatch(/^OBS-[0-9A-F]{4}$/);
    expect(global.puzzles).toEqual([
      'puzzle.carrier',
      'puzzle.pattern',
      'puzzle.archive',
      'puzzle.service',
    ]);
    expect(global.episodes).toEqual(['episode.000']);
    expect(global.seenLines).toContain('echo.carrier.hint.1');
    expect(global.failures).toEqual({ 'puzzle.pattern': 1 });
    expect(global.preferences).toEqual({ muted: true, reducedMotion: true, effects: false });

    const storage = memoryStorage(completedV1);
    const draw = vi.fn(seed);
    const { data, status } = openSaveSession(storage, draw);
    expect(status).toBe('migrated');
    expect(data).toEqual({
      ...global,
      schemaVersion: 2,
      profile: { handle: null, designation, accessLevel: null, seed: 123 },
      doorState: {},
    });
    expect(factsOf(data)).toEqual(
      new Set([
        'solved:puzzle.carrier',
        'solved:puzzle.pattern',
        'solved:puzzle.archive',
        'solved:puzzle.service',
        'acquired:tx.fragment',
        'acquired:tx.grid',
        'acquired:tx.reconstructed',
        'read:manual.rev-c',
        'discovered:relay-07',
        'completed:episode.000',
        'flag:service-panel-open',
        'flag:forge-opened',
      ]),
    );
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(openSaveSession(storage, draw)).toMatchObject({ status: 'loaded', data });
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledOnce();
  });

  it('migrates version 0 progress and designation with default preferences', () => {
    const storage = memoryStorage(
      JSON.stringify({
        schemaVersion: 0,
        puzzles: ['p'],
        transmissions: [],
        archives: [],
        locations: [],
        episodes: [],
        flags: [],
        seenLines: [],
        failures: {},
        designation: 'OBS-0002',
      }),
    );
    const { data, status } = openSaveSession(storage, seed);
    expect(status).toBe('migrated');
    expect(data).toEqual({
      ...freshSave(123),
      puzzles: ['p'],
      preferences: DEFAULT_PREFERENCES,
      profile: { ...freshSave(123).profile, designation: 'OBS-0002' },
    });
    expect(loadSave(storage)).toEqual({ status: 'loaded', data });
  });

  it('isolates corrupt door slots during reads, writes and reloads', () => {
    const data = freshSave(42);
    data.flags.push('forge-opened');
    data.preferences.muted = true;
    data.profile.handle = 'Relay';
    const storage = memoryStorage(
      JSON.stringify({
        ...data,
        doorState: {
          badJson: '{',
          badType: { progress: 1 },
          keeper: '{"nested":[1,true]}',
          ['__proto__']: 'null',
        },
      }),
    );
    const expected = { ...data, doorState: { keeper: { nested: [1, true] }, ['__proto__']: null } };
    const session = openSaveSession(storage);
    expect(session.status).toBe('loaded');
    expect(session.data).toEqual(expected);

    const circular: { self?: unknown } = {};
    circular.self = circular;
    Object.assign(session.data.doorState, { circular, invalid: undefined });
    expect(session.persist()).toBe(true);
    expect(loadSave(storage)).toEqual({ status: 'loaded', data: expected });

    for (const doorState of [[], 'malformed', undefined]) {
      const malformed = memoryStorage(JSON.stringify({ ...data, doorState }));
      expect(loadSave(malformed)).toEqual({ status: 'loaded', data });
    }
  });

  it('keeps future save bytes and refuses all writes for the lifetime of the session', () => {
    const original = ' { "schemaVersion": 99, "newField": ["preserve me"] }\n';
    const storage = memoryStorage(original);
    const session = openSaveSession(storage, seed);
    expect(session).toMatchObject({ status: 'unsupported', data: freshSave(123) });
    addFact(session.data, 'solved:p');
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(storage.value).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();

    // Even if another tab clears storage, this session cannot publish its fallback progress.
    storage.getItem.mockReturnValue(null);
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(storage.value).toBe(original);
  });

  it('guards a future save that appears after supported startup', () => {
    const storage = memoryStorage(JSON.stringify(freshSave(42)));
    const session = openSaveSession(storage);
    expect(session.status).toBe('loaded');
    const future = '{"schemaVersion":3,"future":true}';
    storage.setItem('signal-lost.save', future);
    storage.setItem.mockClear();
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(writeSave(storage, session.data)).toBe(false);
    expect(storage.value).toBe(future);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'new', initial: null },
    { status: 'migrated', initial: completedV1 },
    { status: 'reset', initial: '{ corrupt' },
  ])(
    'preserves a future save that appears before the automatic $status write',
    ({ status, initial }) => {
      const future = ' { "schemaVersion": 3, "future": true }\n';
      const storage = memoryStorage(future);
      storage.getItem.mockReturnValueOnce(initial);

      const session = openSaveSession(storage, seed);

      expect(session.status).toBe(status);
      expect(session.data.profile.seed).toBe(123);
      expect(storage.value).toBe(future);
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    },
  );

  it('clears progress on a deliberate reset', () => {
    const storage = memoryStorage();
    const session = openSaveSession(storage, seed);
    addFact(session.data, 'solved:p');
    expect(session.persist()).toBe(true);
    expect(session.clear()).toBe(true);
    expect(storage.value).toBeNull();
  });

  it('keeps progress in memory if storage denies access', () => {
    const denied = () => {
      throw new Error('storage denied');
    };
    const storage: SaveStorage = { getItem: denied, removeItem: denied, setItem: denied };
    const session = openSaveSession(storage, seed);
    expect(session.status).toBe('new');
    addFact(session.data, 'solved:p');
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(factsOf(session.data).has('solved:p')).toBe(true);
    expect(writeSave({ ...storage, getItem: () => null }, session.data)).toBe(false);
  });
});
