import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getBbsOffer } from '../../src/bbs/bbs.ts';
import { applyBbsEffect, createBbsProgress } from '../../src/bbs/progress.ts';
import { bbsThemeIds } from '../../src/bbs/themes.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import { settleEvents } from '../../src/progress/events.ts';
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
const { content } = loadContent(readContentDir('content'));

describe('save data', () => {
  it('round-trips progress and normalizes the profile', () => {
    const storage = memoryStorage();
    const data = freshSave(0);
    addFact(data, 'solved:p');
    data.preferences = { muted: true, reducedMotion: true, effects: false, bbsTheme: 'ansi' };
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
      preferences: { ...global.preferences, bbsTheme: 'amber' },
      bbs: { replies: {}, discoveries: [], history: [] },
      schemaVersion: 2,
      bbsReadMessages: [],
      events: { fired: [], bulletins: [] },
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
    expect(getBbsOffer(content, factsOf(data))?.board.id).toBe('deep-field');
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(openSaveSession(storage, draw)).toMatchObject({ status: 'loaded', data });
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(draw).toHaveBeenCalledOnce();
  });

  it('offers DEEP FIELD to a pre-feature v2 save without FORGE progress', () => {
    const data = freshSave(42);
    data.episodes.push('episode.000');
    data.profile.designation = 'OBS-02FF';
    const old: Record<string, unknown> = {
      ...data,
      preferences: { muted: false, reducedMotion: null, effects: true },
    };
    delete old['bbsReadMessages'];
    delete old['bbs'];
    delete old['events'];
    const session = openSaveSession(memoryStorage(JSON.stringify(old)));
    expect(session.status).toBe('loaded');
    expect(session.data).toEqual(data);
    expect(session.data.bbs.history).toEqual([]);
    expect(getBbsOffer(content, factsOf(session.data))?.board.id).toBe('deep-field');
  });

  it('reconciles a qualifying pre-event v2 read once on connect and persists the result', () => {
    const data = freshSave(42);
    data.bbsReadMessages = ['message:relay-note'];
    const old: Record<string, unknown> = { ...data };
    delete old['events'];
    const storage = memoryStorage(JSON.stringify(old));
    const loaded = openSaveSession(storage, seed);
    const settle = (candidate: typeof data) => settleEvents(content.events, candidate);
    expect(loaded.status).toBe('loaded');
    expect(loaded.data.events).toEqual({ fired: [], bulletins: [] });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(createBbsProgress(loaded.data, settle, loaded.persist).connect()).toBe(true);
    expect(storage.setItem).toHaveBeenCalledOnce();

    const reloaded = openSaveSession(storage, seed);
    expect(reloaded.data.flags).toEqual(['relay-note-read']);
    expect(reloaded.data.events).toEqual({
      fired: ['relay-read', 'relay-bulletin'],
      bulletins: ['relay-bulletin'],
    });
    expect(createBbsProgress(reloaded.data, settle, reloaded.persist).connect()).toBe(true);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('recovers malformed event state and deduplicates valid IDs in saved order', () => {
    const data = freshSave(42);
    data.flags.push('kept');
    const duplicates = {
      ...data,
      events: { fired: ['b', 'a', 'b'], bulletins: ['second', 'first', 'second'] },
    };
    expect(loadSave(memoryStorage(JSON.stringify(duplicates)))).toEqual({
      status: 'loaded',
      data: { ...data, events: { fired: ['b', 'a'], bulletins: ['second', 'first'] } },
    });
    expect(loadSave(memoryStorage(JSON.stringify({ ...data, events: null })))).toEqual({
      status: 'loaded',
      data,
    });
  });

  it('round-trips BBS progress independently of archive, dialogue and door progress', () => {
    const storage = memoryStorage();
    const { data, persist } = openSaveSession(storage, seed);
    data.profile.handle = '  Finch  ';
    data.bbsReadMessages.push('archive:lore.last-sysop', 'archive:lore.last-sysop', 'message:post');
    data.archives.push('manual.rev-c');
    data.seenLines.push('echo.carrier.hint.1');
    data.doorState['example'] = { opened: true };
    expect(persist()).toBe(true);

    const reopened = openSaveSession(storage);
    expect(reopened.data).toEqual({
      ...data,
      profile: { ...data.profile, handle: 'Finch' },
      bbsReadMessages: ['archive:lore.last-sysop', 'message:post'],
    });
    expect(factsOf(reopened.data)).toEqual(new Set(['read:manual.rev-c', 'bbs-read:post']));

    for (const bbsReadMessages of ['broken', ['archive:lore.last-sysop', 123]]) {
      const malformed = memoryStorage(
        JSON.stringify({ ...JSON.parse(storage.value!), bbsReadMessages }),
      );
      expect(openSaveSession(malformed)).toMatchObject({
        status: 'loaded',
        data: { ...reopened.data, bbsReadMessages: [] },
      });
    }
  });

  it('keeps the newest 100 actions and recovers valid local state beside malformed fields', () => {
    const storage = memoryStorage();
    const { data, persist } = openSaveSession(storage, seed);
    data.archives.push('manual.rev-c');
    data.doorState['kept'] = true;
    for (let i = 0; i < 104; i++) {
      applyBbsEffect(data, { history: { kind: 'thread', id: `thread-${i}` } });
    }
    expect(data.bbs.history).toHaveLength(100);
    expect(data.bbs.history[0]).toEqual({ kind: 'thread', id: 'thread-4' });
    expect(data.bbs.history.at(-1)).toEqual({ kind: 'thread', id: 'thread-103' });
    expect(persist()).toBe(true);
    expect(openSaveSession(storage).data.bbs).toEqual(data.bbs);

    const malformed = {
      ...JSON.parse(storage.value!),
      bbs: {
        replies: { 'relay-thread': null, 'earlier-thread': 'earlier-choice' },
        discoveries: ['linecheck', 7, 'linecheck'],
        history: [{ kind: 'bogus' }, { kind: 'sign-in', handle: 'ignore me', visitors: 100 }],
      },
    };
    expect(openSaveSession(memoryStorage(JSON.stringify(malformed))).data).toEqual({
      ...data,
      bbs: {
        replies: { 'earlier-thread': 'earlier-choice' },
        discoveries: ['linecheck'],
        history: [{ kind: 'sign-in' }],
      },
    });
    expect(openSaveSession(memoryStorage(JSON.stringify({ ...malformed, bbs: [] }))).data).toEqual({
      ...data,
      bbs: { replies: {}, discoveries: [], history: [] },
    });
  });

  it.each(bbsThemeIds)('round-trips %s alongside motion and effects', (bbsTheme) => {
    const storage = memoryStorage();
    const { data, persist } = openSaveSession(storage, seed);
    data.preferences = { bbsTheme, reducedMotion: false, effects: false, muted: true };
    expect(persist()).toBe(true);
    expect(openSaveSession(storage).data.preferences).toEqual(data.preferences);
    const invalid = { ...data, preferences: { ...data.preferences, bbsTheme: 'missing' } };
    expect(openSaveSession(memoryStorage(JSON.stringify(invalid))).data.preferences).toEqual({
      ...data.preferences,
      bbsTheme: 'amber',
    });
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
