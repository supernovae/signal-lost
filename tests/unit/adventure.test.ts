import { describe, expect, it } from 'vitest';
import { getBbsOffer } from '../../src/bbs/bbs.ts';
import { createBbsDoorSession } from '../../src/bbs/door-session.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import type { DoorPayload, RunningDoor } from '../../src/doors/contract.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { factsOf, freshSave, openSaveSession, writeSave } from '../../src/progress/save.ts';
import tiny from '../fixtures/tiny-adventure.json';

const files = readContentDir('content');
const bundled = loadContent(files);
const adventure = bundled.content.doors.find((door) => door.kind === 'adventure')!;
const chapter = 'completed:episode.000';
const proof = 'flag:deferred-verified';
const learned = 'flag:spool-02-order-learned';
const indexed = 'flag:forgotten-archive-indexed';
const restricted = 'flag:forgotten-archive-restricted';
const registry = createDoorRegistry(bundled.content.doors);
const admission = new Set([chapter, proof]);
const progress = { hasFact: (fact: string) => admission.has(fact) };
const returnToMenu = { kind: 'exit', returnTo: 'bbs-menu' };

const fragments = ['SEAL', 'ROUTE', 'ACK'];
const inspectCommands = fragments.map((name) => `INSPECT ${name} FRAGMENT`);
const correctOrder = 'SEAL / ROUTE / ACK';
const notebook = 'TRAINING NOTEBOOK: SEAL / ROUTE / ACK.';
const decisionCommands = ['INDEX COPY', 'SEALED REFERENCES'];

function memorySave() {
  let bytes: string | null = null;
  const storage = {
    getItem: () => bytes,
    setItem: (_key: string, value: string) => {
      bytes = value;
    },
    removeItem: () => {
      bytes = null;
    },
  };
  const data = freshSave(42);
  data.episodes.push('episode.000');
  data.flags.push('deferred-verified', 'unrelated');
  data.profile.designation = 'OBS-02FF';
  data.doorState['relay-trivia'] = { version: 1, payload: 1 };
  writeSave(storage, data);
  const open = () => {
    const { data, persist } = openSaveSession(storage, () => 42);
    return { data, host: createDoorHost(registry, data, persist) };
  };
  return { storage, open };
}

function earned(running: RunningDoor) {
  return running.checkpoint(progress).earnedRewards;
}

async function lifecycle() {
  const registration = registry.find(adventure.id, admission)!;
  return (await registration.load(42)).default;
}

describe('Forgotten Archive', () => {
  it('walks every checkpoint through the lifecycle and back out through the BBS', async () => {
    expect(bundled.errors).toEqual([]);
    const door = await lifecycle();
    const initial = door.launch(progress).checkpoint(progress).payload;
    const initialKey = JSON.stringify(initial);
    const queue = [{ key: initialKey, payload: initial, trail: [] as string[] }];
    const seen = new Set([initialKey]);
    const edges = new Map<string, Set<string>>();
    const locations = new Set<string>();
    const endings = new Set<string>();
    const vestibules = new Set<string>();
    const learnedShelves = new Set<string>();
    const unlearnedEndings = new Set<string>();
    const offer = getBbsOffer(bundled.content, admission)!;
    let directLearning: string[] | undefined;

    for (const { key, payload, trail } of queue) {
      const running = door.restore(payload, progress)!;
      const state = payload as {
        locationId: string;
        inspectedItemIds: string[];
        flags: string[];
        endingId: string | null;
      };
      locations.add(state.locationId);
      if (state.locationId === adventure.startLocationId) vestibules.add(key);
      const rewards = earned(running)!;
      if (state.endingId) {
        endings.add(state.endingId);
        if (!rewards.includes(learned)) unlearnedEndings.add(key);
      }
      if (state.locationId === 'training-shelf' && rewards.includes(learned)) {
        learnedShelves.add(key);
        expect(running.screen.actions).toContainEqual({
          command: 'NOTEBOOK',
          label: 'Read notebook',
        });
        expect(running.input('NOTEBOOK', progress).lines).toContain(notebook);
        if (state.inspectedItemIds.length === 3 && !state.endingId) {
          expect(rewards).toEqual([learned]);
          directLearning ??= trail;
        }
      }

      const data = freshSave(42);
      data.episodes.push('episode.000');
      data.flags.push('deferred-verified');
      data.profile.designation = 'OBS-02FF';
      data.doorState[adventure.id] = { version: adventure.version, payload };
      const bbs = createBbsDoorSession(
        offer,
        () => data,
        createDoorHost(registry, data, () => true),
      );
      for (const command of ['CONNECT', 'DESIGNATION', 'DOORS', `OPEN ${adventure.id}`]) {
        await bbs.dispatch(command);
      }
      expect(bbs.screen().phase, trail.join(' → ')).toBe('door');
      expect(
        bbs.screen().actions.map(({ command }) => command),
        trail.join(' → '),
      ).toContain('EXIT');
      expect((await bbs.dispatch('EXIT'))?.output.flatMap(({ lines }) => lines)).toContain(
        'DEEP FIELD MAIN MENU',
      );
      expect(bbs.screen().phase).toBe('menu');
      expect(data.doorState[adventure.id]).toEqual({ version: adventure.version, payload });

      for (const { command } of running.screen.actions) {
        const visit = door.restore(payload, progress)!;
        visit.input(command, progress);
        const next = visit.checkpoint(progress).payload;
        const nextKey = JSON.stringify(next);
        if (!edges.has(nextKey)) edges.set(nextKey, new Set());
        edges.get(nextKey)!.add(key);
        if (!seen.has(nextKey)) {
          seen.add(nextKey);
          queue.push({ key: nextKey, payload: next, trail: [...trail, command] });
        }
      }
    }

    function predecessors(targets: Set<string>) {
      const reachable = new Set(targets);
      for (const target of reachable) {
        for (const previous of edges.get(target) ?? []) reachable.add(previous);
      }
      return reachable;
    }

    expect(locations).toEqual(new Set(adventure.locations.map(({ id }) => id)));
    expect(endings).toEqual(new Set(adventure.endings.map(({ id }) => id)));
    expect(
      new Set(
        queue
          .filter(({ key }) => unlearnedEndings.has(key))
          .map(({ payload }) => (payload as { endingId: string }).endingId),
      ),
    ).toEqual(endings);
    expect(directLearning).toEqual(['TRAINING SHELF', ...inspectCommands, correctOrder]);
    const canReturn = predecessors(vestibules);
    const canLearn = predecessors(learnedShelves);
    for (const { key, trail } of queue) {
      expect(canReturn.has(key), trail.join(' → ')).toBe(true);
      if (unlearnedEndings.has(key)) expect(canLearn.has(key), trail.join(' → ')).toBe(true);
    }
    expect(seen.size).toBe(216);
  });

  it.each([
    ['ROUTE / ACK / SEAL', 'ROUTE is missing the seal reference.'],
    ['ROUTE / SEAL / ACK', 'ROUTE is missing the seal reference.'],
    ['ACK / ROUTE / SEAL', 'ACK is missing the destination receipt.'],
    ['ACK / SEAL / ROUTE', 'ACK is missing the destination receipt.'],
    ['SEAL / ACK / ROUTE', 'ACK is missing the destination receipt.'],
  ])(
    'explains the first missing input for %s and keeps the evidence readable',
    async (order, feedback) => {
      const visit = (await lifecycle()).launch(progress);
      expect(visit.input('TRAINING SHELF', progress).lines).toContain(
        'POSTED RULE: An operation may only consume outputs already produced.',
      );
      const readClues = () =>
        inspectCommands.map((command, i) =>
          visit
            .input(command, progress)
            .lines.find((line) => line.startsWith(`${fragments[i]} FRAGMENT`)),
        );
      const clues = readClues();
      expect(clues[0]).toContain('SEAL fixes an immutable original and issues a seal reference');
      expect(clues[1]).toContain(
        'ROUTE requires the seal reference and issues a destination receipt',
      );
      expect(clues[2]).toContain('ACK requires the destination receipt and records delivery');
      const wrong = visit.input(order, progress);
      expect(wrong.lines.filter((line) => line.includes(' is missing '))).toEqual([feedback]);
      expect(wrong.actions.map(({ command }) => command)).toEqual(
        expect.arrayContaining(inspectCommands),
      );
      expect(earned(visit)).toEqual([]);
      expect(readClues()).toEqual(clues);
      expect(visit.input('  seal/ route /ack ', progress).lines).toContain(
        'PROCEDURE LEARNED. The training notebook is available.',
      );
      expect(visit.input(order, progress).lines).toContain(feedback);
      expect(earned(visit)).toEqual([learned]);
      expect(visit.input('NOTEBOOK', progress).lines).toContain(notebook);
    },
  );

  it.each([0, 1, 2, 3, 4, 5, 6])(
    'rejects the canonical sequence for incomplete inspection mask %i',
    async (mask) => {
      const { open } = memorySave();
      const { data, host } = open();
      await host.launch(adventure.id);
      const unavailable = host.input('INSPECT SEAL FRAGMENT');
      expect(unavailable).toMatchObject({
        screen: { lines: expect.arrayContaining(['Unknown or unavailable action.']) },
      });
      host.input('TRAINING SHELF');
      for (const [i, command] of inspectCommands.entries()) {
        if (mask & (1 << i)) {
          host.input(command);
          host.input(command);
        }
      }
      expect(host.input('SEAL / ROUTE')).toMatchObject({
        screen: { lines: expect.arrayContaining(['Unknown or unavailable action.']) },
      });
      const result = host.input(correctOrder);
      if (result.kind !== 'screen') throw new Error('Expected the training shelf');
      expect(result.screen.lines).toContain(
        'Inspect all three training fragments before recording the procedure.',
      );
      expect(result.screen.actions.map(({ command }) => command)).not.toContain('NOTEBOOK');
      expect(data.doorState[adventure.id]).toMatchObject({
        payload: { flags: [], endingId: null },
      });
      expect(factsOf(data).has(learned)).toBe(false);
      expect(factsOf(open().data).has(learned)).toBe(false);
    },
  );

  it('restores only valid checkpoints and normalizes duplicate evidence', async () => {
    const door = await lifecycle();
    const state = {
      locationId: 'training-shelf',
      inspectedItemIds: ['seal-fragment', 'route-fragment', 'ack-fragment', 'seal-fragment'],
      flags: ['order-learned', 'order-learned'],
      endingId: null,
    };
    const restored = door.restore(state, progress)!;
    expect(restored.checkpoint(progress)).toEqual({
      payload: {
        ...state,
        inspectedItemIds: ['ack-fragment', 'route-fragment', 'seal-fragment'],
        flags: ['order-learned'],
      },
      earnedRewards: [learned],
    });
    const badStates: DoorPayload[] = [
      { ...state, locationId: 'nowhere' },
      { ...state, inspectedItemIds: ['seal-fragment'] },
      { ...state, inspectedItemIds: [...state.inspectedItemIds, 'unknown-item'] },
      { ...state, flags: ['unknown-flag'] },
      { ...state, endingId: 'unknown-ending' },
    ];
    for (const bad of badStates) expect(door.restore(bad, progress)).toBeUndefined();
  });

  it.each([
    ['INDEX COPY', 'SEALED REFERENCES', 'indexed', indexed, 'FILING RESULT: LABELED COPY INDEXED.'],
    [
      'SEALED REFERENCES',
      'INDEX COPY',
      'restricted',
      restricted,
      'FILING RESULT: SEALED REFERENCES ONLY.',
    ],
  ])(
    'persists the distinct %s outcome and restores its evidence and dialogue',
    async (decision, sibling, endingId, reward, result) => {
      const { open } = memorySave();
      const { host } = open();
      await host.launch(adventure.id);
      host.input('COMPARISON DESK');
      expect(host.input('TALK GHOST')).toMatchObject({
        screen: { lines: expect.arrayContaining([expect.stringContaining('RETAINED INDEX NOTE')]) },
      });
      host.input('INSPECT COPY SCOPE');

      const { host: reloaded } = open();
      expect(await reloaded.launch(adventure.id)).toMatchObject({
        screen: { lines: expect.arrayContaining(['COMPARISON DESK']) },
      });
      expect(reloaded.input('TALK GHOST')).toMatchObject({
        screen: { lines: expect.arrayContaining([expect.stringContaining('RETAINED BENCH NOTE')]) },
      });
      reloaded.input('PRESERVATION VAULT');
      expect(reloaded.input(decision)).toMatchObject({
        screen: { lines: expect.arrayContaining(['Unknown or unavailable action.']) },
      });
      reloaded.input('INSPECT CUSTODY POLICY');
      expect(reloaded.input('TALK PACKET')).toMatchObject({
        screen: {
          lines: expect.arrayContaining([expect.stringContaining('RETAINED CUSTODY NOTE')]),
        },
      });
      const chosen = reloaded.input(decision);
      if (chosen.kind !== 'screen') throw new Error('Expected the filing result');
      expect(chosen.screen.lines).toContainEqual(expect.stringContaining(result));
      expect(
        chosen.screen.actions.filter(({ command }) => decisionCommands.includes(command)),
      ).toEqual([]);
      reloaded.input(sibling);
      expect(reloaded.exit()).toEqual(returnToMenu);

      const reopened = open();
      expect(await reopened.host.launch(adventure.id)).toMatchObject({
        screen: { lines: expect.arrayContaining([expect.stringContaining(result)]) },
      });
      expect(reopened.host.input(sibling)).toMatchObject({
        screen: { lines: expect.arrayContaining(['Unknown or unavailable action.']) },
      });
      expect(reopened.host.exit()).toEqual(returnToMenu);
      expect(adventure.rewards.filter((fact) => factsOf(reopened.data).has(fact))).toEqual([
        reward,
      ]);
      expect(reopened.data.flags).toEqual(['deferred-verified', 'unrelated', reward.slice(5)]);
      expect(reopened.data.doorState).toEqual({
        'relay-trivia': { version: 1, payload: 1 },
        [adventure.id]: {
          version: adventure.version,
          payload: {
            locationId: 'preservation-vault',
            inspectedItemIds: ['copy-scope', 'custody-policy'],
            flags: [],
            endingId,
          },
        },
      });
    },
  );

  it('allows a fresh slot to earn the sibling reward when an earlier reward is already saved', async () => {
    const { open, storage } = memorySave();
    const { data } = open();
    data.flags.push(indexed.slice(5));
    writeSave(storage, data);
    const { host } = open();
    await host.launch(adventure.id);
    for (const command of [
      'COMPARISON DESK',
      'INSPECT COPY SCOPE',
      'PRESERVATION VAULT',
      'INSPECT CUSTODY POLICY',
      'SEALED REFERENCES',
    ]) {
      expect(host.input(command).kind).toBe('screen');
    }
    expect(adventure.rewards.filter((fact) => factsOf(open().data).has(fact))).toEqual([
      indexed,
      restricted,
    ]);
  });

  it('discovers a second adventure from fixture JSON through the same host', async () => {
    const file = 'content/doors/tiny-adventure.json';
    expect(Object.hasOwn(files, file)).toBe(false);
    expect(
      bundled.manifest.entries.filter(({ kind }) => kind === 'doors').map(({ id }) => id),
    ).toEqual(['forgotten-archive', 'relay-trivia']);
    expect(registry.find(tiny.id, admission)).toBeUndefined();
    const loaded = loadContent({ ...files, [file]: tiny });
    expect(loaded.errors).toEqual([]);
    expect(loaded.manifest.entries).toContainEqual({ id: tiny.id, kind: 'doors', file });
    const data = freshSave(42);
    data.episodes.push('episode.000');
    const host = createDoorHost(createDoorRegistry(loaded.content.doors), data, () => true);
    expect(await host.launch(tiny.id)).toMatchObject({
      screen: { lines: expect.arrayContaining(['LANDING']) },
    });
    expect(host.input('DOWN')).toMatchObject({
      screen: { lines: expect.arrayContaining(['BENCH']) },
    });
    expect(host.input('READ LOG')).toMatchObject({
      screen: { lines: expect.arrayContaining(['Bench log: switch tested.']) },
    });
    expect(host.input('FILE LOG')).toMatchObject({
      screen: { lines: expect.arrayContaining(['The bench log is filed.']) },
    });
    expect(data.flags).toEqual(['bench-log-filed']);
    expect(host.exit()).toEqual(returnToMenu);
  });
});
