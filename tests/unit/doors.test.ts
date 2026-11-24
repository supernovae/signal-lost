import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { getBbsOffer } from '../../src/bbs/bbs.ts';
import { createBbsDoorSession } from '../../src/bbs/door-session.ts';
import { readContentDir } from '../../src/content/node.ts';
import type { DoorMetadata } from '../../src/content/schema.ts';
import { loadContent } from '../../src/content/validate.ts';
import {
  defineDoor,
  type CodeDoorRegistration,
  type DoorDefinition,
  type DoorLifecycle,
  type DoorProgress,
} from '../../src/doors/contract.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { factsOf, freshSave, openSaveSession, writeSave } from '../../src/progress/save.ts';

const { content } = loadContent(readContentDir('content'));
const relay = content.doors.find(({ id }) => id === 'relay-trivia')!;
const reward = 'flag:relay-trivia-complete';
const acknowledgement = 'RELAY DRILL: COMPLETE';
const completed = 'completed:episode.000';
const offer = getBbsOffer(content, new Set([completed]))!;
const completion = 'DRILL COMPLETE. TRAINING RECORD LOGGED.';
const firstPrompt = relay.questions[0]!.prompt[1]!;
const secondPrompt = relay.questions[1]!.prompt[1]!;
const otherSlot = { version: 3, payload: { key: 'another-door-sentinel' } };
const answer = (index: number) => String(relay.questions[index]!.answer + 1);

function memoryStorage() {
  let value: string | null = null;
  return {
    get value() {
      return value!;
    },
    getItem: () => value,
    setItem: vi.fn((_key: string, text: string) => {
      value = text;
    }),
    removeItem: () => {
      value = null;
    },
  };
}

function seedBoard() {
  const storage = memoryStorage();
  const data = freshSave(42);
  data.episodes.push('episode.000');
  data.puzzles.push('puzzle.carrier');
  data.flags.push('existing');
  data.profile.designation = 'OBS-02FF';
  data.profile.handle = 'Finch';
  data.bbsReadMessages.push('archive:lore.last-sysop');
  data.doorState['other-door'] = structuredClone(otherSlot);
  return { storage, data };
}

function openBoard(
  storage: ReturnType<typeof memoryStorage>,
  codeDoors: readonly CodeDoorRegistration[] = [],
) {
  const { data, persist } = openSaveSession(storage, () => 42);
  const registry = createDoorRegistry(content.doors, codeDoors);
  const host = createDoorHost(registry, data, persist);
  const bbs = createBbsDoorSession(offer, () => data, host);
  return { data, host, bbs };
}

async function signIn(bbs: ReturnType<typeof createBbsDoorSession>) {
  await bbs.dispatch('CONNECT');
  return (await bbs.dispatch('DESIGNATION'))!.output.flatMap(({ lines }) => lines);
}

function metadata(id: string): DoorMetadata {
  return {
    id,
    name: 'Counter',
    description: 'A test door',
    attribution: { author: 'Test' },
    version: 1,
    requires: { all: [completed] },
    rewards: ['flag:counted'],
    returnTo: 'bbs-menu',
  };
}

type Counter = { count: number };

function counterDefinition(): DoorDefinition<Counter, Counter> {
  const show = (state: Counter) => ({
    state,
    screen: { lines: [`COUNT ${state.count}`], actions: [{ command: '+', label: 'COUNT' }] },
  });
  return {
    saveState: z.strictObject({ count: z.number().int().min(0).max(2) }),
    launch: () => show({ count: 0 }),
    restore: (saved) => show(saved),
    input(state) {
      state.count = Math.min(state.count + 1, 2);
      return show(state);
    },
    save: (state) => state,
    isComplete: (saved) => saved.count === 2,
    exit() {},
  };
}

function codeDoor(id: string, definition = counterDefinition()): CodeDoorRegistration {
  return {
    source: 'tests/unit/doors.test.ts',
    metadata: metadata(id),
    load: async () => ({ default: defineDoor(definition) }),
  };
}

describe('door registry and checkpoints', () => {
  it('registers both kinds under one ID namespace and loads code only on selection', async () => {
    const counter = codeDoor('counter');
    const load = vi.spyOn(counter, 'load');
    const registry = createDoorRegistry([relay], [counter]);
    expect(registry.list(new Set()).map(({ id }) => id)).toEqual([]);
    expect(registry.list(new Set([completed])).map(({ id }) => id)).toEqual([
      'relay-trivia',
      'counter',
    ]);
    expect(load).not.toHaveBeenCalled();
    expect(() => createDoorRegistry([relay, relay])).toThrow('duplicate door id "relay-trivia"');
    expect(() => createDoorRegistry([], [counter, counter])).toThrow('duplicate door id "counter"');
    expect(() => createDoorRegistry([relay], [codeDoor(relay.id)])).toThrow(
      'duplicate door id "relay-trivia"',
    );
    const data = freshSave(42);
    const host = createDoorHost(registry, data, () => true);
    await expect(host.launch('counter')).resolves.toEqual({ kind: 'unavailable' });
    await expect(host.launch(relay.id)).resolves.toEqual({ kind: 'unavailable' });
    expect(load).not.toHaveBeenCalled();
    data.episodes.push('episode.000');
    await expect(host.launch('counter')).resolves.toMatchObject({
      kind: 'screen',
      screen: { lines: ['COUNT 0'] },
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it('saves on input and exit and restores the next question from serialized storage', async () => {
    const { storage, data } = seedBoard();
    writeSave(storage, data);
    const { host } = openBoard(storage);
    expect(await host.launch(relay.id)).toMatchObject({
      kind: 'screen',
      screen: { lines: expect.arrayContaining([firstPrompt]) },
    });
    expect(host.input('1')).toMatchObject({
      screen: { lines: expect.arrayContaining(relay.questions[0]!.retry) },
    });
    expect(host.input(answer(0))).toMatchObject({
      screen: { lines: expect.arrayContaining([secondPrompt]) },
    });
    expect(host.exit()).toEqual({ kind: 'exit', returnTo: 'bbs-menu' });
    expect(host.input('1')).toEqual({ kind: 'unavailable' });
    const reloaded = openBoard(storage);
    expect(reloaded.data.doorState[relay.id]).toEqual({ version: relay.version, payload: 1 });
    expect(factsOf(reloaded.data).has(reward)).toBe(false);
    expect(await reloaded.host.launch(relay.id)).toMatchObject({
      screen: { lines: expect.arrayContaining([secondPrompt]) },
    });
  });

  it('only exposes fact queries and a detached own slot, and only grants registered facts', async () => {
    const { storage, data } = seedBoard();
    data.doorState['counter'] = { version: 1, payload: { count: 0 } };
    writeSave(storage, data);
    const otherBytes = JSON.parse(storage.value).doorState['other-door'];
    const definition = counterDefinition();
    let working: Counter | undefined;
    let saved: Counter | undefined;
    let initialFacts: DoorProgress | undefined;
    const restore = vi.fn((payload: Counter, facts: DoorProgress) => {
      initialFacts ??= facts;
      expect(Object.keys(facts)).toEqual(['hasFact']);
      expect(Object.isFrozen(facts)).toBe(true);
      expect(Reflect.set(facts, 'addFact', () => {})).toBe(false);
      expect(facts.hasFact(completed)).toBe(true);
      expect(payload).toEqual({ count: payload.count });
      expect(JSON.stringify([payload, facts])).not.toContain('another-door-sentinel');
      const step = definition.restore(payload, facts);
      working = step.state;
      return step;
    });
    const entry = codeDoor('counter', {
      ...definition,
      restore,
      input(state, command, facts) {
        working = state;
        return {
          ...definition.input(state, command, facts),
          rewards: ['flag:injected'],
          slot: 'other-door',
        };
      },
      save(state) {
        saved = { ...state };
        return saved;
      },
    });
    const { host, data: live } = openBoard(storage, [entry]);
    entry.metadata.rewards.push('flag:added-after-registration');
    await host.launch('counter');
    expect(restore).toHaveBeenCalledExactlyOnceWith({ count: 0 }, initialFacts);
    working!.count = 99;
    expect(live.doorState['counter']).toEqual({ version: 1, payload: { count: 0 } });
    working!.count = 0;
    expect(host.input('+').kind).toBe('screen');
    working!.count = 99;
    saved!.count = 99;
    expect(live.doorState['counter']).toEqual({ version: 1, payload: { count: 1 } });
    expect(live.flags).toEqual(['existing']);
    working!.count = 1;
    expect(host.exit().kind).toBe('exit');
    expect(live.flags).toEqual(['existing']);
    await host.launch('counter');
    expect(host.input('+').kind).toBe('screen');
    expect(live.flags).toEqual(['existing', 'counted']);
    expect(initialFacts!.hasFact('flag:counted')).toBe(false);
    expect(host.exit().kind).toBe('exit');

    // Use the original reviewed metadata for the fresh registry built on reload.
    entry.metadata.rewards.pop();
    const finished = openBoard(storage, [entry]);
    await finished.host.launch('counter');
    expect(finished.host.input('+').kind).toBe('screen');
    expect(finished.host.exit().kind).toBe('exit');
    expect(finished.data).toEqual({
      ...data,
      flags: ['existing', 'counted'],
      doorState: { 'other-door': otherSlot, counter: { version: 1, payload: { count: 2 } } },
    });
    expect(JSON.parse(storage.value).doorState['other-door']).toBe(otherBytes);
  });
});

describe('BBS door recovery', () => {
  it.each(['launch', 'input', 'save', 'restore', 'exit', 'isComplete'] as const)(
    'returns to the signed-in menu when %s throws and preserves the previous save',
    async (method) => {
      const { storage, data } = seedBoard();
      data.doorState['fault'] = { version: method === 'launch' ? 2 : 1, payload: { count: 1 } };
      writeSave(storage, data);
      const fail = vi.fn(() => {
        throw new Error(`test failure in ${method}`);
      });
      const { bbs, data: live } = openBoard(storage, [
        codeDoor('fault', { ...counterDefinition(), [method]: fail }),
      ]);
      const previous = storage.value;
      await signIn(bbs);
      await bbs.dispatch('DOORS');
      const opened = (await bbs.dispatch('OPEN fault'))!;
      const result =
        method === 'launch' || method === 'restore'
          ? opened
          : (await bbs.dispatch(method === 'exit' ? 'EXIT' : '+'))!;
      expect(fail).toHaveBeenCalledOnce();
      expect(result.output[0]?.tone).toBe('network-error');
      expect(result.effect).toBeUndefined();
      expect(result.output.flatMap(({ lines }) => lines)).toContain(offer.board.doorError);
      expect(result.output.flatMap(({ lines }) => lines)).toContain('DEEP FIELD MAIN MENU');
      expect(bbs.screen().phase).toBe('menu');
      expect((await bbs.dispatch('MESSAGES'))!.output.flatMap(({ lines }) => lines)).toContain(
        'DEEP FIELD MESSAGES',
      );
      expect((await bbs.dispatch('HELP'))!.output.flatMap(({ lines }) => lines)).toContain(
        bbs.screen().hint,
      );
      expect(storage.value).toBe(previous);
      expect(live).toEqual(data);
    },
  );

  it('keeps the prior slot and facts in memory and on disk when the checkpoint write fails', async () => {
    const { storage, data } = seedBoard();
    data.doorState['counter'] = { version: 1, payload: { count: 1 } };
    writeSave(storage, data);
    const { bbs, data: live } = openBoard(storage, [codeDoor('counter')]);
    const previous = storage.value;
    await signIn(bbs);
    await bbs.dispatch('DOORS');
    await bbs.dispatch('OPEN counter');
    storage.setItem.mockClear();
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('storage refused write');
    });
    expect((await bbs.dispatch('+'))!.output.flatMap(({ lines }) => lines)).toContain(
      offer.board.doorError,
    );
    expect(bbs.screen().phase).toBe('menu');
    expect(storage.setItem).toHaveBeenCalledOnce();
    const proposed = JSON.parse(storage.setItem.mock.calls[0]![1]);
    expect(proposed.flags).toEqual(['existing', 'counted']);
    expect(JSON.parse(proposed.doorState.counter)).toEqual({ version: 1, payload: { count: 2 } });
    expect(storage.value).toBe(previous);
    expect(live).toEqual(data);
  });

  it.each([
    ['invalid slot JSON', '{broken'],
    ['wrong door version', JSON.stringify({ version: relay.version + 1, payload: 1 })],
    ['invalid door payload', JSON.stringify({ version: relay.version, payload: 999 })],
  ])('starts from question one after %s and replaces only the door slot', async (_case, slot) => {
    const { storage, data } = seedBoard();
    writeSave(storage, data);
    const stored = JSON.parse(storage.value);
    stored.doorState[relay.id] = slot;
    storage.setItem('signal-lost.save', JSON.stringify(stored));
    const { bbs } = openBoard(storage);
    await signIn(bbs);
    await bbs.dispatch('DOORS');
    expect(
      (await bbs.dispatch(`OPEN ${relay.id}`))!.output.flatMap(({ lines }) => lines),
    ).toContain(firstPrompt);
    expect(storage.value).toBe(JSON.stringify(stored));
    await bbs.dispatch(answer(0));
    await bbs.dispatch('EXIT');
    expect(JSON.parse(storage.value).doorState['other-door']).toBe(stored.doorState['other-door']);
    expect(openBoard(storage).data).toEqual({
      ...data,
      doorState: { ...data.doorState, [relay.id]: { version: relay.version, payload: 1 } },
    });
  });

  it('starts the board before a throwing optional module is evaluated and recovers after selection', async () => {
    const { storage, data } = seedBoard();
    writeSave(storage, data);
    const load = vi.fn(() => import('../fixtures/throwing-door.ts'));
    const { bbs } = openBoard(storage, [
      { source: 'tests/fixtures/throwing-door.ts', metadata: metadata('fault'), load },
    ]);
    expect(await signIn(bbs)).toContain('SIGNED IN AS OBS-02FF');
    await bbs.dispatch('MESSAGES');
    expect((await bbs.dispatch('READ 1'))!.output[0]?.tone).toBe('history');
    await bbs.dispatch('MENU');
    await bbs.dispatch('DOORS');
    expect(bbs.screen().actions).toContainEqual({ command: 'OPEN fault', label: 'Counter' });
    expect(load).not.toHaveBeenCalled();
    expect((await bbs.dispatch('OPEN fault'))!.output.flatMap(({ lines }) => lines)).toContain(
      offer.board.doorError,
    );
    expect(load).toHaveBeenCalledOnce();
    expect(bbs.screen().phase).toBe('menu');
    await bbs.dispatch('DOORS');
    expect(
      (await bbs.dispatch(`OPEN ${relay.id}`))!.output.flatMap(({ lines }) => lines),
    ).toContain(firstPrompt);
    expect((await bbs.dispatch(answer(0)))!.output.flatMap(({ lines }) => lines)).toContain(
      secondPrompt,
    );
  });

  it('handles one selection at a time while a code door is loading', async () => {
    const { storage, data } = seedBoard();
    writeSave(storage, data);
    let finish!: (module: { default: DoorLifecycle }) => void;
    const pending = new Promise<{ default: DoorLifecycle }>((resolve) => {
      finish = resolve;
    });
    const load = vi.fn(() => pending);
    const locked = codeDoor('locked');
    locked.metadata.requires = 'flag:locked';
    const loadLocked = vi.spyOn(locked, 'load');
    const { bbs } = openBoard(storage, [
      { source: 'tests/unit/doors.test.ts', metadata: metadata('slow'), load },
      locked,
    ]);
    await signIn(bbs);
    await bbs.dispatch('DOORS');
    expect(bbs.screen().actions.map(({ command }) => command)).not.toContain('OPEN locked');
    expect((await bbs.dispatch('OPEN locked'))!.output.flatMap(({ lines }) => lines)).toContain(
      'DOOR UNAVAILABLE.',
    );
    expect(loadLocked).not.toHaveBeenCalled();
    const opening = bbs.dispatch('OPEN slow');
    await expect(bbs.dispatch('OPEN slow')).resolves.toBeUndefined();
    await expect(bbs.dispatch('DISCONNECT')).resolves.toBeUndefined();
    finish({ default: defineDoor(counterDefinition()) });
    const launched = (await opening)!;
    expect(launched.output.flatMap(({ lines }) => lines)).toContain('COUNT 0');
    expect(launched.effect).toEqual({ history: { kind: 'door', id: 'slow' } });
    expect(load).toHaveBeenCalledOnce();
    expect((await bbs.dispatch('EXIT'))!.output.flatMap(({ lines }) => lines)).toContain(
      'DEEP FIELD MAIN MENU',
    );
  });
});

it('shows the authored board reward only after relay trivia completion and keeps it after reconnect', async () => {
  const { storage, data } = seedBoard();
  writeSave(storage, data);
  const { bbs, data: live } = openBoard(storage);
  expect(relay.rewards).toEqual([reward]);
  expect(offer.board.status).toContainEqual({ when: reward, text: acknowledgement });
  expect(await signIn(bbs)).not.toContain(acknowledgement);
  await bbs.dispatch('DOORS');
  expect((await bbs.dispatch(`OPEN ${relay.id}`))!.output.flatMap(({ lines }) => lines)).toContain(
    firstPrompt,
  );
  await bbs.dispatch(answer(0));
  expect((await bbs.dispatch('EXIT'))!.output.flatMap(({ lines }) => lines)).not.toContain(
    acknowledgement,
  );
  await bbs.dispatch('DOORS');
  expect((await bbs.dispatch(`OPEN ${relay.id}`))!.output.flatMap(({ lines }) => lines)).toContain(
    secondPrompt,
  );
  expect((await bbs.dispatch(answer(1)))!.output.flatMap(({ lines }) => lines)).toContain(
    completion,
  );
  expect(factsOf(live).has(reward)).toBe(true);
  expect((await bbs.dispatch('EXIT'))!.output.flatMap(({ lines }) => lines)).toContain(
    acknowledgement,
  );
  expect(bbs.screen().phase).toBe('menu');
  const reloaded = openBoard(storage);
  expect(factsOf(reloaded.data).has(reward)).toBe(true);
  expect(await signIn(reloaded.bbs)).toContain(acknowledgement);
  await reloaded.bbs.dispatch('DOORS');
  expect(
    (await reloaded.bbs.dispatch(`OPEN ${relay.id}`))!.output.flatMap(({ lines }) => lines),
  ).toContain(completion);
  expect(reloaded.bbs.screen().actions).toEqual([{ command: 'EXIT', label: 'EXIT' }]);
});
