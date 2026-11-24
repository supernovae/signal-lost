import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import { defineDoor, type CodeDoorRegistration } from '../../src/doors/contract.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { deriveAccessLevel, hasAccessLevel } from '../../src/progress/access.ts';
import { factsOf, freshSave, openSaveSession, type SaveStorage } from '../../src/progress/save.ts';
import { createGame } from '../../src/puzzle/game.ts';

const files = readContentDir('content');
const { content } = loadContent(files);
const panel = 'flag:service-panel-open';
const drill = 'flag:relay-trivia-complete';
const episode = 'completed:episode.000';

describe('access levels', () => {
  it.each([
    { route: 'no progress', facts: [], label: 'VISITOR', rank: 0 },
    { route: 'episode complete', facts: [episode], label: 'VISITOR', rank: 0 },
    { route: 'unrelated progress', facts: ['flag:forge-opened'], label: 'VISITOR', rank: 0 },
    { route: 'service panel only', facts: [panel], label: 'RELAY', rank: 1 },
    { route: 'relay drill only', facts: [drill], label: 'RELAY', rank: 1 },
    { route: 'both rewards', facts: [panel, drill], label: 'RELAY', rank: 1 },
  ])('derives $label from $route and keeps it as facts accumulate', ({ facts, label, rank }) => {
    const levels = content.accessLevels;
    const initial = deriveAccessLevel(levels, new Set(facts));
    expect(initial).toMatchObject({ label, rank });
    const reversed = [...levels].reverse();
    expect(deriveAccessLevel(reversed, new Set([...facts].reverse()))).toEqual(initial);
    const superset = new Set([...facts, episode, 'flag:forge-opened', 'bbs-read:relay-note']);
    expect(deriveAccessLevel(reversed, superset)).toEqual(initial);
    expect(
      deriveAccessLevel(levels, new Set([...superset, panel, drill]))?.rank,
    ).toBeGreaterThanOrEqual(rank);
  });

  it('selects the highest eligible tier and honors lower thresholds', () => {
    const {
      content: { accessLevels },
      errors,
    } = loadContent({
      ...files,
      'content/access-levels/above-relay.json': {
        id: 'above-relay',
        label: 'ABOVE RELAY',
        rank: 2,
        when: { all: [{ any: [panel, drill] }, 'bbs-read:relay-note'] },
      },
    });
    expect(errors).toEqual([]);
    const facts = new Set([drill]);
    expect(deriveAccessLevel(accessLevels, facts)?.rank).toBe(1);
    facts.add('bbs-read:relay-note');
    const higher = deriveAccessLevel(accessLevels, facts);
    expect(higher?.rank).toBe(2);
    expect(hasAccessLevel(accessLevels, higher, 'relay')).toBe(true);
    expect(hasAccessLevel(accessLevels, higher, 'missing')).toBe(false);
    expect(deriveAccessLevel([], facts)).toBeUndefined();
    expect(hasAccessLevel(accessLevels, undefined, 'relay')).toBe(false);
  });
});

const common = 'solved:p.common';
const solved = 'solved:p.research';
const receipt = 'flag:trade-receipt';
const codePuzzle = {
  kind: 'code',
  title: 'Fixture puzzle',
  briefing: [],
  answer: '42',
  feedback: [],
};

const tradeScreen = (exchanged: boolean) => ({
  state: exchanged,
  screen: exchanged
    ? { lines: ['Exchange complete.'], actions: [] }
    : {
        lines: ['The trader offers a receipt in exchange for a sample.'],
        actions: [{ command: 'TRADE', label: 'Exchange sample' }],
      },
});
const trade: CodeDoorRegistration = {
  source: 'tests/unit/access.test.ts',
  metadata: {
    id: 'test-trade',
    name: 'Trade counter',
    description: 'Exchange one sample.',
    attribution: { author: 'Test' },
    version: 1,
    requires: common,
    rewards: [receipt],
    returnTo: 'bbs-menu',
  },
  async load() {
    return {
      default: defineDoor({
        saveState: z.boolean(),
        launch: () => tradeScreen(false),
        restore: tradeScreen,
        input: (exchanged, command) => tradeScreen(exchanged || command === 'TRADE'),
        save: (exchanged) => exchanged,
        isComplete: (exchanged) => exchanged,
        exit() {},
      }),
    };
  },
};

it('reaches the same required level from a fixture puzzle or a single fixture trade, including after reopen', async () => {
  const { content: fixture, errors } = loadContent(
    {
      'content/puzzles/common.json': { ...codePuzzle, id: 'p.common' },
      'content/puzzles/research.json': { ...codePuzzle, id: 'p.research', requires: common },
      'content/access-levels/visitor.json': { id: 'visitor', label: 'VISITOR', rank: 0 },
      'content/access-levels/required.json': {
        id: 'required',
        label: 'REQUIRED',
        rank: 1,
        when: { any: [solved, receipt] },
      },
    },
    [trade],
  );
  expect(errors).toEqual([]);

  function start() {
    let saved: string | null = null;
    const storage: SaveStorage = {
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
      removeItem: () => {
        saved = null;
      },
    };
    const session = openSaveSession(storage, () => 42);
    session.data.puzzles.push('p.common');
    expect(session.persist()).toBe(true);
    expect(factsOf(session.data)).toEqual(new Set([common]));
    return { ...session, reopen: () => openSaveSession(storage) };
  }

  const puzzleRun = start();
  const tradeRun = start();
  const game = createGame({ content: fixture, data: puzzleRun.data, persist: puzzleRun.persist });
  const host = createDoorHost(
    createDoorRegistry(fixture.doors, [trade]),
    tradeRun.data,
    tradeRun.persist,
  );
  const level = (facts: ReadonlySet<string>) => deriveAccessLevel(fixture.accessLevels, facts)?.id;

  expect(level(game.facts())).toBe('visitor');
  expect(level(host.facts())).toBe('visitor');
  expect(game.attempt('p.research', { kind: 'code', code: 'wrong' }).status).toBe('wrong');
  expect(level(game.facts())).toBe('visitor');
  expect((await host.launch(trade.metadata.id)).kind).toBe('screen');
  expect(level(host.facts())).toBe('visitor');
  expect(host.input('DECLINE').kind).toBe('screen');
  expect(level(host.facts())).toBe('visitor');

  expect(game.attempt('p.research', { kind: 'code', code: '42' }).granted).toEqual([solved]);
  expect(host.input('TRADE').kind).toBe('screen');
  expect(host.exit().kind).toBe('exit');
  expect(game.facts()).toEqual(new Set([common, solved]));
  expect(host.facts()).toEqual(new Set([common, receipt]));

  for (const [run, routeFact] of [
    [puzzleRun, solved],
    [tradeRun, receipt],
  ] as const) {
    expect(level(factsOf(run.data))).toBe('required');
    const reopened = run.reopen();
    expect(reopened.status).toBe('loaded');
    expect(factsOf(reopened.data)).toEqual(new Set([common, routeFact]));
    expect(level(factsOf(reopened.data))).toBe('required');
  }
  expect(tradeRun.reopen().data.flags).toEqual(['trade-receipt']);
});

it('opens the reviewed archive through the shipped service puzzle or the relay door reward', () => {
  function start() {
    const data = freshSave(42);
    data.episodes.push('episode.000');
    return createGame({ content, data, persist() {} });
  }
  const archive = 'community.second-line';
  const panelRun = start();
  expect(panelRun.archives().map(({ id }) => id)).not.toContain(archive);
  const puzzle = panelRun.puzzle('puzzle.service');
  if (puzzle.kind !== 'code') throw new Error('expected the service code puzzle');
  expect(panelRun.attempt(puzzle.id, { kind: 'code', code: puzzle.answer }).granted).toContain(
    panel,
  );
  expect(panelRun.archives().map(({ id }) => id)).toContain(archive);

  const doorRun = start();
  expect(doorRun.archives().map(({ id }) => id)).not.toContain(archive);
  doorRun.grant([drill]);
  expect(doorRun.archives().map(({ id }) => id)).toContain(archive);
  expect(doorRun.transmissions().map(({ id }) => id)).not.toContain('tx.first-light');
});
