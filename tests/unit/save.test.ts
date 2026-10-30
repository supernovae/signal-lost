import { describe, expect, it } from 'vitest';
import {
  addFact,
  factsOf,
  freshSave,
  loadSave,
  resetSave,
  writeSave,
  type SaveStorage,
} from '../../src/progress/save.ts';

function memoryStorage(initial?: string): SaveStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value;
    },
    setItem(_key, value) {
      this.value = value;
    },
    removeItem() {
      this.value = null;
    },
  };
}

describe('save data', () => {
  it('round-trips every category with a schema version', () => {
    const storage = memoryStorage();
    const data = freshSave();
    ['solved:p', 'acquired:t', 'read:a', 'discovered:l', 'completed:e', 'flag:f'].forEach((f) =>
      addFact(data, f),
    );
    data.preferences = { muted: true, reducedMotion: true, effects: false };
    data.designation = 'OBS-0001';
    expect(writeSave(storage, data)).toBe(true);

    const { data: loaded, status } = loadSave(storage);
    expect(status).toBe('loaded');
    expect(loaded).toEqual(data);
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.puzzles).toEqual(['p']);
    expect(loaded.transmissions).toEqual(['t']);
    expect(loaded.archives).toEqual(['a']);
    expect(loaded.locations).toEqual(['l']);
    expect(loaded.episodes).toEqual(['e']);
    expect(loaded.flags).toEqual(['f']);
    expect(factsOf(loaded).has('completed:e')).toBe(true);
  });

  it('starts fresh with no save', () => {
    expect(loadSave(memoryStorage()).status).toBe('new');
  });

  it.each([
    ['invalid JSON', '{ nope'],
    ['the wrong shape', '{"schemaVersion":1,"puzzles":"oops"}'],
    ['a future version', '{"schemaVersion":99}'],
    ['a non-object', '7'],
  ])('resets gracefully on %s', (_name, text) => {
    const { data, status } = loadSave(memoryStorage(text));
    expect(status).toBe('reset');
    expect(data).toEqual(freshSave());
  });

  it('migrates a version 0 save and keeps its progress', () => {
    const old: Record<string, unknown> = { ...freshSave(), schemaVersion: 0, puzzles: ['p'] };
    delete old['preferences'];
    const text = JSON.stringify(old);
    const { data, status } = loadSave(memoryStorage(text));
    expect(status).toBe('migrated');
    expect(data.puzzles).toEqual(['p']);
    expect(data.preferences.effects).toBe(true);
  });

  it('clears progress on a deliberate reset', () => {
    const storage = memoryStorage();
    const data = freshSave();
    addFact(data, 'solved:p');
    writeSave(storage, data);
    expect(resetSave(storage)).toEqual(freshSave());
    expect(storage.value).toBeNull();
  });

  it('reports a refused write without throwing', () => {
    const storage: SaveStorage = {
      getItem: () => null,
      removeItem() {},
      setItem() {
        throw new Error('quota');
      },
    };
    expect(writeSave(storage, freshSave())).toBe(false);
  });
});
