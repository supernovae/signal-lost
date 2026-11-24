import { expect, it, vi } from 'vitest';
import type { NetworkEvent } from '../../src/content/schema.ts';
import { settleEvents } from '../../src/progress/events.ts';
import { addFact, freshSave, loadSave, writeSave, type SaveData } from '../../src/progress/save.ts';
import { createGame } from '../../src/puzzle/game.ts';
import { emptyContent } from './helpers.ts';

const flag = (name: string) => ({ kind: 'grant-flag' as const, flag: name });
const bulletin = (messageId: string) => ({ kind: 'post-bulletin' as const, messageId });

it('settles in ID order across input permutations and across saves', () => {
  const events: NetworkEvent[] = [
    { id: 'a-consumer', when: 'flag:ready', effects: [bulletin('first')] },
    { id: 'b-producer', when: 'flag:start', effects: [flag('ready')] },
    { id: 'c-sibling', when: 'flag:start', effects: [bulletin('second'), bulletin('third')] },
    { id: 'd-later', when: 'flag:later', effects: [bulletin('first'), bulletin('fourth')] },
  ];
  let raw: string | null = null;
  const storage = {
    getItem: () => raw,
    setItem: (_key: string, text: string) => {
      raw = text;
    },
    removeItem: () => {
      raw = null;
    },
  };
  const uninterrupted = freshSave(42);
  const beforeReload = freshSave(42);
  for (const [data, records] of [
    [uninterrupted, events],
    [beforeReload, [...events].reverse()],
  ] as const) {
    expect(settleEvents(records, data)).toEqual([]);
    addFact(data, 'flag:start');
    expect(settleEvents(records, data)).toEqual(['b-producer', 'a-consumer', 'c-sibling']);
    expect(data.flags).toEqual(['start', 'ready']);
    expect(data.events).toEqual({
      fired: ['b-producer', 'a-consumer', 'c-sibling'],
      bulletins: ['first', 'second', 'third'],
    });
    addFact(data, 'flag:start');
    expect(settleEvents(records, data)).toEqual([]);
    data.bbsReadMessages.push('message:first');
  }

  expect(writeSave(storage, beforeReload)).toBe(true);
  const resumed = loadSave(storage);
  expect(resumed).toEqual({ status: 'loaded', data: uninterrupted });
  for (const data of [uninterrupted, resumed.data]) {
    addFact(data, 'flag:later');
    expect(settleEvents(events, data)).toEqual(['d-later']);
    expect(data.flags).toEqual(['start', 'ready', 'later']);
    expect(data.events).toEqual({
      fired: ['b-producer', 'a-consumer', 'c-sibling', 'd-later'],
      bulletins: ['first', 'second', 'third', 'fourth'],
    });
    expect(data.bbsReadMessages).toEqual(['message:first']);
  }
  expect(resumed.data).toEqual(uninterrupted);
  expect(writeSave(storage, resumed.data)).toBe(true);
  const settled = loadSave(storage).data;
  expect(settleEvents(events, settled)).toEqual([]);
  expect(settled).toEqual(uninterrupted);
});

it('rechecks eligibility after each event, including negated conditions', () => {
  const events: NetworkEvent[] = [
    { id: 'first', when: 'flag:trigger', effects: [flag('ready')] },
    {
      id: 'second',
      when: { all: ['flag:trigger', { not: 'flag:ready' }] },
      effects: [bulletin('stale')],
    },
  ];
  const data = freshSave(42);
  addFact(data, 'flag:trigger');
  expect(settleEvents(events, data)).toEqual(['first']);
  expect(data.events.bulletins).toEqual([]);
});

it('persists puzzle, episode and direct grants with their effects in the same write', () => {
  const content = emptyContent();
  content.puzzles.push({
    id: 'code',
    kind: 'code',
    title: 'Code',
    briefing: [],
    answer: '1',
    feedback: [],
    success: [],
    grants: ['flag:puzzle-reward'],
  });
  content.episodes.push({
    id: 'episode',
    title: 'Episode',
    puzzles: ['code'],
    ending: [],
    grants: ['flag:episode-reward'],
    designationPrefix: 'OBS',
  });
  content.events.push(
    {
      id: 'completion',
      when: {
        all: ['solved:code', 'completed:episode', 'flag:puzzle-reward', 'flag:episode-reward'],
      },
      effects: [flag('confirmed')],
    },
    { id: 'direct', when: 'flag:manual', effects: [bulletin('receipt')] },
  );
  const data = freshSave(42);
  const persist = vi.fn((candidate: SaveData) => structuredClone(candidate));
  const game = createGame({ content, data, persist });
  expect(game.attempt('code', { kind: 'code', code: '1' }).granted).toEqual([
    'solved:code',
    'flag:puzzle-reward',
    'completed:episode',
    'flag:episode-reward',
  ]);
  expect(persist).toHaveBeenCalledOnce();
  expect(persist.mock.results[0]?.value).toMatchObject({
    puzzles: ['code'],
    episodes: ['episode'],
    flags: ['puzzle-reward', 'episode-reward', 'confirmed'],
    events: { fired: ['completion'], bulletins: [] },
  });
  expect(game.grant(['flag:manual'])).toEqual(['flag:manual']);
  expect(game.grant(['flag:manual'])).toEqual([]);
  expect(persist).toHaveBeenCalledTimes(2);
  expect(persist.mock.results[1]?.value).toMatchObject({
    flags: ['puzzle-reward', 'episode-reward', 'confirmed', 'manual'],
    events: { fired: ['completion', 'direct'], bulletins: ['receipt'] },
  });
});
