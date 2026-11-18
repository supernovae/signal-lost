import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addFact,
  factsOf,
  freshSave,
  loadSave,
  type SaveSession,
  type SaveStorage,
} from '../../src/progress/save.ts';

interface LegacySave {
  schemaVersion: number;
  puzzles: string[];
  transmissions: string[];
  archives: string[];
  locations: string[];
  episodes: string[];
  flags: string[];
  seenLines: string[];
  failures: Record<string, number>;
  preferences: { muted: boolean; reducedMotion: boolean | null; effects: boolean };
  designation: string | null;
}

/** The real version 1 save captured from the original writer; see IMPLEMENTATION.md. */
const legacyFixture = (): LegacySave =>
  JSON.parse(readFileSync('tests/fixtures/save-v1-episode-000.json', 'utf8')) as LegacySave;

type MemoryStorage = SaveStorage & { value: string | null; writes: number; removals: number };

function memoryStorage(initial: string | null = null): MemoryStorage {
  return {
    value: initial,
    writes: 0,
    removals: 0,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.writes += 1;
      this.value = value;
    },
    removeItem() {
      this.removals += 1;
      this.value = null;
    },
  };
}

/** A complete version 2 save as text, with `doorState: {}` left open to replace. */
const v2Save = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 2,
    puzzles: [],
    transmissions: [],
    archives: [],
    locations: [],
    episodes: [],
    flags: [],
    seenLines: [],
    failures: {},
    preferences: { muted: false, reducedMotion: null, effects: true },
    profile: { handle: null, designation: null, accessLevel: null, seed: 1 },
    doorState: {},
    ...over,
  });

// A profile with a handle of the wrong type is global corruption: a reset.
const corruptProfile = v2Save({
  profile: { handle: 7, designation: null, accessLevel: null, seed: 1 },
});

describe('save data', () => {
  it('round-trips every category with the version 2 shape', () => {
    const storage = memoryStorage();
    const session = loadSave(storage);
    const data = session.data;
    expect(session.status).toBe('new');
    ['solved:p', 'acquired:t', 'read:a', 'discovered:l', 'completed:e', 'flag:f'].forEach((f) =>
      addFact(data, f),
    );
    data.preferences = { muted: true, reducedMotion: true, effects: false };
    data.profile.handle = 'Keel';
    data.profile.designation = 'OBS-0001';
    data.profile.accessLevel = 'FIELD';
    data.doorState['door.north'] = { tries: 2, notes: ['sealed', null] };
    expect(session.persist()).toBe(true);

    const reopened = loadSave(storage);
    expect(reopened.status).toBe('loaded');
    expect(reopened.data).toEqual(data);
    expect(reopened.data.schemaVersion).toBe(2);
    expect(factsOf(reopened.data).has('completed:e')).toBe(true);
    expect(reopened.data.doorState['door.north']).toEqual({ tries: 2, notes: ['sealed', null] });
  });

  it('starts fresh with no save, drawing one seed', () => {
    let draws = 0;
    const seedSource = (): number => {
      draws += 1;
      return 7;
    };
    const session = loadSave(memoryStorage(), { seedSource });
    expect(session.status).toBe('new');
    expect(draws).toBe(1);
    expect(session.data).toEqual(freshSave(7));
  });

  it.each([
    ['invalid JSON', '{ nope'],
    ['the wrong shape', '{"schemaVersion":2,"puzzles":"oops"}'],
    ['a non-object', '7'],
    ['a corrupt profile', corruptProfile],
    [
      'a legacy save with a junk designation',
      '{"schemaVersion":1,"puzzles":[],"transmissions":[],"archives":[],"locations":[],"episodes":[],"flags":[],"seenLines":[],"failures":{},"preferences":{"muted":false,"reducedMotion":null,"effects":true},"designation":7}',
    ],
  ])('resets gracefully on %s, with a fresh version 2 fallback', (_name, text) => {
    let draws = 0;
    const seedSource = (): number => {
      draws += 1;
      return 11;
    };
    const { data, status } = loadSave(memoryStorage(text), { seedSource });
    expect(status).toBe('reset');
    expect(data).toEqual(freshSave(11));
    expect(draws).toBe(1);
  });

  it('migrates a real version 1 save with Episode 000 complete', () => {
    const fixture = legacyFixture();
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.episodes).toContain('episode.000');
    expect(fixture.puzzles).toContain('puzzle.service');
    expect(fixture.locations).toContain('relay-07');
    expect(fixture.flags).toEqual(['service-panel-open', 'forge-opened']);
    expect(fixture.seenLines).toEqual(['echo.carrier.solved']);
    expect(fixture.preferences).toEqual({ muted: true, reducedMotion: true, effects: false });
    expect(fixture.designation).toMatch(/^OBS-[0-9A-F]{4}$/);

    let draws = 0;
    const seedSource = (): number => {
      draws += 1;
      return 606;
    };
    const storage = memoryStorage(JSON.stringify(fixture));
    const session = loadSave(storage, { seedSource });
    const { data, status } = session;
    expect(status).toBe('migrated');
    expect(data.schemaVersion).toBe(2);
    expect(draws).toBe(1);
    expect(data.puzzles).toEqual(fixture.puzzles);
    expect(data.transmissions).toEqual(fixture.transmissions);
    expect(data.archives).toEqual(fixture.archives);
    expect(data.locations).toEqual(fixture.locations);
    expect(data.episodes).toEqual(fixture.episodes);
    expect(data.flags).toEqual(fixture.flags);
    expect(data.seenLines).toEqual(fixture.seenLines);
    expect(data.failures).toEqual(fixture.failures);
    expect(data.preferences).toEqual(fixture.preferences);
    expect(data.profile).toEqual({
      handle: null,
      designation: fixture.designation,
      accessLevel: null,
      seed: 606,
    });
    expect(data.doorState).toEqual({});

    // The facts are exactly the ones the legacy fields describe.
    const expected = new Set<string>();
    const byPrefix: Record<string, readonly string[]> = {
      solved: fixture.puzzles,
      acquired: fixture.transmissions,
      read: fixture.archives,
      discovered: fixture.locations,
      completed: fixture.episodes,
      flag: fixture.flags,
    };
    for (const [prefix, ids] of Object.entries(byPrefix)) {
      for (const id of ids) expected.add(`${prefix}:${id}`);
    }
    expect(factsOf(data)).toEqual(expected);
    expect(expected.has('completed:episode.000')).toBe(true);
    expect(expected.has('solved:puzzle.service')).toBe(true);
    expect(expected.has('discovered:relay-07')).toBe(true);
    expect(expected.has('flag:forge-opened')).toBe(true);

    // The migration is stored immediately, and reloads without drawing again.
    expect(storage.value).not.toBeNull();
    const stored = JSON.parse(storage.value!) as {
      schemaVersion: number;
      profile: { seed: number; designation: string | null };
    };
    expect(stored.schemaVersion).toBe(2);
    expect(stored.profile.seed).toBe(606);
    expect(stored.profile.designation).toBe(fixture.designation);
    const reopened = loadSave(storage, {
      seedSource: () => {
        throw new Error('a persisted save needs no seed');
      },
    });
    expect(reopened.status).toBe('loaded');
    expect(reopened.data).toEqual(data);
  });

  it('migrates a version 0 save through to version 2', () => {
    const fixture = legacyFixture();
    const old: Record<string, unknown> = { ...fixture, schemaVersion: 0 };
    delete old['preferences'];
    const storage = memoryStorage(JSON.stringify(old));
    const { data, status } = loadSave(storage, { seedSource: () => 42 });
    expect(status).toBe('migrated');
    expect(data.schemaVersion).toBe(2);
    expect(data.puzzles).toEqual(fixture.puzzles);
    expect(data.transmissions).toEqual(fixture.transmissions);
    expect(data.archives).toEqual(fixture.archives);
    expect(data.locations).toEqual(fixture.locations);
    expect(data.episodes).toEqual(fixture.episodes);
    expect(data.flags).toEqual(fixture.flags);
    expect(data.seenLines).toEqual(fixture.seenLines);
    expect(data.failures).toEqual(fixture.failures);
    expect(data.preferences).toEqual({ muted: false, reducedMotion: null, effects: true });
    expect(data.profile).toEqual({
      handle: null,
      designation: fixture.designation,
      accessLevel: null,
      seed: 42,
    });
    expect(data.doorState).toEqual({});
    expect(storage.value).not.toBeNull();
    expect((JSON.parse(storage.value!) as { schemaVersion: number }).schemaVersion).toBe(2);
    const reopened = loadSave(storage);
    expect(reopened.status).toBe('loaded');
    expect(reopened.data).toEqual(data);
  });

  it('recovers door slots independently when one is damaged', () => {
    // The numeric token 1e400 parses to Infinity, which does not round-trip.
    const base = v2Save({
      puzzles: ['puzzle.carrier'],
      profile: { handle: null, designation: 'OBS-0001', accessLevel: null, seed: 5 },
    });
    const text = base.replace(
      '"doorState":{}',
      '"doorState":{"alpha":{"list":[1,"two",{"deep":null}]},"broken":{"bad":1e400},"omega":null}',
    );
    const storage = memoryStorage(text);
    const session = loadSave(storage);
    const { data, status } = session;
    expect(status).toBe('loaded');
    expect(data.puzzles).toEqual(['puzzle.carrier']);
    expect(data.profile.designation).toBe('OBS-0001');
    expect(data.doorState).toEqual({ alpha: { list: [1, 'two', { deep: null }] }, omega: null });
    expect('broken' in data.doorState).toBe(false);

    // The repaired map is what gets stored.
    expect(session.persist()).toBe(true);
    const reopened = loadSave(storage);
    expect(reopened.status).toBe('loaded');
    expect(reopened.data.doorState).toEqual({
      alpha: { list: [1, 'two', { deep: null }] },
      omega: null,
    });
  });

  it.each([
    ['an array', '["slot"]'],
    ['a string', '"doors"'],
  ])('normalizes a door state map that is %s', (_name, doorText) => {
    const { data, status } = loadSave(
      memoryStorage(v2Save().replace('"doorState":{}', `"doorState":${doorText}`)),
    );
    expect(status).toBe('loaded');
    expect(data.doorState).toEqual({});
  });

  it('treats a missing door state as an empty map', () => {
    const { data, status } = loadSave(memoryStorage(v2Save({ doorState: undefined })));
    expect(status).toBe('loaded');
    expect(data.doorState).toEqual({});
  });

  it('keeps a __proto__ door slot as data, never as a prototype', () => {
    const text = v2Save().replace(
      '"doorState":{}',
      '"doorState":{"__proto__":{"evil":true},"safe":1}',
    );
    const { data, status } = loadSave(memoryStorage(text));
    expect(status).toBe('loaded');
    expect(Object.keys(data.doorState).sort()).toEqual(['__proto__', 'safe']);
    expect(data.doorState['__proto__']).toEqual({ evil: true });
    expect(data.doorState['safe']).toBe(1);
    expect(Object.getPrototypeOf(data.doorState)).toBe(null);
    expect(({} as Record<string, unknown>)['evil']).toBeUndefined();
  });

  it('leaves a newer save untouched and refuses every mutation', () => {
    const future = '  { "schemaVersion" : 99, "extra" : { "deep" : [true] } }  ';
    const storage = memoryStorage(future);
    let draws = 0;
    const seedSource = (): number => {
      draws += 1;
      return 5;
    };
    const session = loadSave(storage, { seedSource });
    expect(session.status).toBe('unsupported');
    expect(draws).toBe(1);
    expect(session.data).toEqual(freshSave(5));

    // The session stays playable in memory, but never touches the stored save.
    addFact(session.data, 'solved:p');
    expect(session.data.puzzles).toEqual(['p']);
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(session.persist()).toBe(false);
    expect(storage.writes).toBe(0);
    expect(storage.removals).toBe(0);
    expect(storage.value).toBe(future);
  });

  it('latches the lock when a newer save appears mid-session', () => {
    const storage = memoryStorage();
    const session = loadSave(storage);
    expect(session.persist()).toBe(true);
    expect(storage.writes).toBe(1);

    const future = '{"schemaVersion":3,"unknown":true}';
    storage.value = future; // Another tab stores a newer save.
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(storage.value).toBe(future);

    storage.value = null; // The newer save is removed elsewhere; the lock stays.
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
    expect(storage.writes).toBe(1);
    expect(storage.removals).toBe(0);
    expect(storage.value).toBeNull();
  });

  it('keeps the stored seed when the injected source changes', () => {
    const storage = memoryStorage();
    const first = loadSave(storage, { seedSource: () => 100 });
    expect(first.data.profile.seed).toBe(100);
    first.persist();
    const second = loadSave(storage, { seedSource: () => 200 });
    expect(second.status).toBe('loaded');
    expect(second.data.profile.seed).toBe(100);
  });

  it('normalizes the handle on load, and again before storing', () => {
    const saveWithHandle = (handle: string): string =>
      v2Save({ profile: { handle, designation: null, accessLevel: null, seed: 9 } });
    const loaded = (handle: string): SaveSession => loadSave(memoryStorage(saveWithHandle(handle)));
    expect(loaded('  Keel  ').data.profile.handle).toBe('Keel');
    expect(loaded('   ').data.profile.handle).toBeNull();
    expect(loaded('').data.profile.handle).toBeNull();
    expect(loaded(`Keel${'e'.repeat(40)}`).data.profile.handle).toBe(`Keel${'e'.repeat(28)}`);
    // The cap counts code points, not UTF-16 units: 40 emoji become 32.
    expect(loaded('👍'.repeat(40)).data.profile.handle).toBe('👍'.repeat(32));

    const storage = memoryStorage();
    const session = loadSave(storage);
    session.data.profile.handle = '  Keel  ';
    expect(session.persist()).toBe(true);
    const stored = JSON.parse(storage.value!) as { profile: { handle: string | null } };
    expect(stored.profile.handle).toBe('Keel');
    expect(session.data.profile.handle).toBe('Keel');
  });

  it('clears progress on a deliberate reset', () => {
    const storage = memoryStorage();
    const session = loadSave(storage);
    addFact(session.data, 'solved:p');
    expect(session.persist()).toBe(true);
    expect(session.clear()).toBe(true);
    expect(storage.value).toBeNull();
    expect(storage.removals).toBe(1);
  });

  it('reports a refused write or removal without throwing', () => {
    const storage: SaveStorage = {
      getItem: () => null,
      setItem() {
        throw new Error('quota');
      },
      removeItem() {
        throw new Error('denied');
      },
    };
    const session = loadSave(storage);
    expect(session.persist()).toBe(false);
    expect(session.clear()).toBe(false);
  });
});
