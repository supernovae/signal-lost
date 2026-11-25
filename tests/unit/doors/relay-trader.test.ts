import assert from 'node:assert/strict';
import { describe, expect, it, vi } from 'vitest';
import { getBbsOffer } from '../../../src/bbs/bbs.ts';
import { createBbsDoorSession } from '../../../src/bbs/door-session.ts';
import { readContentDir } from '../../../src/content/node.ts';
import { loadContent } from '../../../src/content/validate.ts';
import { manifest } from '../../../src/doors/code-door-content.ts';
import { createDoorHost } from '../../../src/doors/host.ts';
import { createDoorRegistry } from '../../../src/doors/registry.ts';
import {
  applyMarketAction,
  cargoCount,
  departures,
  legalMarketActions,
  marketStateSchema,
  MAX_PRICE,
  MIN_PRICE,
  newMarket,
  quoteMarket,
  RACK_CAPACITY,
  RECOVERY_CREDITS,
  RESOURCES,
  ROUTES,
  START_CREDITS,
  STATIONS,
  type MarketAction,
  type MarketState,
  type Resource,
  type Station,
} from '../../../src/doors/relay-trader/economy.ts';
import { createRelayTraderDoor } from '../../../src/doors/relay-trader/relay-trader.ts';
import { settleEvents } from '../../../src/progress/events.ts';
import {
  factsOf,
  freshSave,
  openSaveSession,
  writeSave,
  type SaveData,
  type SaveStorage,
} from '../../../src/progress/save.ts';
import { mulberry32 } from '../../../src/signal/rng.ts';

const buy = (resource: Resource): MarketAction => ({ kind: 'buy', resource });
const sell = (resource: Resource): MarketAction => ({ kind: 'sell', resource });
const travel = (to: Station): MarketAction => ({ kind: 'travel', to });
const buyCell = buy('power-cell');
const sellCell = sell('power-cell');
const toYard = travel('switchyard');
const toQuay = travel('null-quay');
const toRelay = travel('far-relay');
const upgrade = { kind: 'upgrade' } as const;
const recover = { kind: 'recover' } as const;
const safeRun = [buyCell, buyCell, toYard, sellCell, sellCell];
const receipt = 'Exchange receipt: ACK SPOOL-02 accepted for R07-SPOOL-02.';
const intro = 'PACKET: NULL QUAY acknowledgement desk.';
const flag = 'manifest-r07-spool-02';
const fact = `flag:${flag}`;
const openTrader = 'OPEN relay-trader';
const openHunter = 'OPEN signal-hunter';
const noFacts = { hasFact: () => false };
const content = loadContent(readContentDir('content')).content;

function saleValue(state: MarketState) {
  return (
    MAX_PRICE *
    STATIONS.flatMap((station) => quoteMarket(state, station)).reduce(
      (sum, quote) => sum + quote.demand,
      0,
    )
  );
}

const runBound = Math.max(START_CREDITS, RECOVERY_CREDITS) + saleValue(newMarket(0));

function advance(state: MarketState, action: MarketAction) {
  const result = applyMarketAction(state, action);
  assert(result.accepted, `Illegal test move: ${JSON.stringify(action)}`);
  const next = result.state;
  assert(next.credits + saleValue(next) <= runBound);
  if (action.kind === 'recover') {
    assert.equal(next.credits, RECOVERY_CREDITS);
    assert(!departures(state.location).some(({ toll }) => toll <= state.credits));
    assert.deepEqual(next.quotas, state.quotas);
  } else {
    // Credits can increase only when a sale consumes a unit of finite demand.
    assert(next.credits + saleValue(next) <= state.credits + saleValue(state));
    if (next.credits > state.credits) {
      assert.equal(action.kind, 'sell');
      assert.equal(saleValue(state) - saleValue(next), MAX_PRICE);
      assert(next.credits - state.credits <= MAX_PRICE);
    }
  }
  return result;
}

function play(state: MarketState, actions: readonly MarketAction[]): MarketState {
  return actions.reduce((market, action) => advance(market, action).state, state);
}

function rejected(state: MarketState, action: MarketAction) {
  const before = structuredClone(state);
  const result = applyMarketAction(state, action);
  expect(result.accepted).toBe(false);
  expect(result.state).toEqual(before);
  expect(state).toEqual(before);
}

describe('Relay Trader market', () => {
  it('maintains the market invariants through 96 legal turns on each of 256 seeds', () => {
    let losses = 0;
    let safePassages = 0;
    for (let seed = 0; seed < 256; seed++) {
      const select = mulberry32(seed ^ 0xa5a5a5a5);
      let state = newMarket(seed);
      for (let turn = 0; turn < 96; turn++) {
        const actions = legalMarketActions(state);
        const action = actions[Math.floor(select() * actions.length)]!;
        const before = state;
        const result = advance(state, action);
        state = result.state;
        assert(cargoCount(state.cargo) <= RACK_CAPACITY[state.rack]);
        assert(Number.isInteger(state.credits) && state.credits >= 0);
        assert(marketStateSchema.safeParse(state).success);
        const nextActions = legalMarketActions(state);
        const canDepart = departures(state.location).some(({ toll }) => state.credits >= toll);
        assert.equal(
          nextActions.some(({ kind }) => kind === 'travel'),
          canDepart,
        );
        assert.equal(
          nextActions.some(({ kind }) => kind === 'recover'),
          !canDepart,
        );
        for (const station of STATIONS) {
          for (const { buy, sell } of quoteMarket(state, station)) {
            for (const price of [buy, sell]) {
              assert(Number.isInteger(price) && price >= MIN_PRICE && price <= MAX_PRICE);
            }
          }
        }
        if (state.riskyTrips !== before.riskyTrips && cargoCount(before.cargo)) {
          if (result.lost) losses++;
          else safePassages++;
        }
      }
    }
    expect(losses).toBeGreaterThan(0);
    expect(safePassages).toBeGreaterThan(0);
  });

  it('rejects unavailable actions, recovers with the hold intact and limits the subsidy', () => {
    const start = newMarket(42);
    rejected(start, sellCell);
    rejected(start, upgrade);
    rejected(start, recover);
    rejected(start, travel('null-quay'));
    const emptyStock = structuredClone(start);
    emptyStock.quotas['null-quay']['power-cell'].stock = 0;
    rejected(emptyStock, buyCell);

    const full = play(start, [buyCell, buyCell, buyCell]);
    expect(cargoCount(full.cargo)).toBe(3);
    const nextTrip = applyMarketAction(full, toRelay);
    rejected(full, buyCell);
    expect(applyMarketAction(full, toRelay)).toEqual(nextTrip);
    const stranded = play(full, [toRelay, toYard]);
    expect(stranded).toMatchObject({ credits: 0, riskyTrips: 1 });
    rejected(stranded, toQuay);
    rejected(stranded, buyCell);

    const towed = advance(stranded, recover).state;
    expect(towed).toEqual({ ...stranded, credits: RECOVERY_CREDITS, location: 'null-quay' });
    const sold = advance(towed, sellCell).state;
    expect(sold.credits).toBe(13);
    expect(sold.quotas['null-quay']['power-cell'].demand).toBe(0);
    rejected(sold, sellCell);
    rejected(sold, recover);

    const tierTwo = play(start, [
      ...safeRun,
      upgrade,
      toQuay,
      buyCell,
      buyCell,
      toYard,
      sellCell,
      sellCell,
      upgrade,
    ]);
    expect(tierTwo.rack).toBe(2);
    expect(RACK_CAPACITY[tierTwo.rack]).toBe(7);
    expect(legalMarketActions({ ...tierTwo, credits: 30 })).not.toContainEqual(upgrade);
    const rackTowed = advance({ ...tierTwo, credits: 1 }, recover).state;
    expect(rackTowed).toEqual({ ...tierTwo, location: 'null-quay', credits: RECOVERY_CREDITS });
  });

  it('uses the fixed cargo loss order on exposed trips', () => {
    const mixed = play(newMarket(7), [buy('coolant'), buyCell]);
    const crossed = advance(mixed, toRelay);
    expect(crossed.lost).toBe('power-cell');
    expect(crossed.state.cargo).toEqual({ 'power-cell': 0, coolant: 1, coil: 0 });
  });

  it('rejects invalid restore bounds and unexpected or missing keys', () => {
    const start = newMarket(42);
    for (const invalid of [
      { ...start, riskyTrips: 0x100000000 },
      { ...start, credits: START_CREDITS + 1 },
      { ...start, cargo: { ...start.cargo, 'power-cell': 4 } },
      { ...start, cargo: { ...start.cargo, extra: 0 } },
      { ...start, cargo: { coolant: 0, coil: 0 } },
      { ...start, quotas: { ...start.quotas, extra: start.quotas.switchyard } },
      { ...start, quotas: { switchyard: start.quotas.switchyard } },
    ]) {
      expect(marketStateSchema.safeParse(invalid).success).toBe(false);
    }
    for (const field of ['stock', 'demand'] as const) {
      const invalid = structuredClone(start);
      invalid.quotas['null-quay']['power-cell'][field]++;
      expect(marketStateSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('reaches the rack goal in six turns across 34 seeds, with a seeded shortcut variant', () => {
    const seeds = [...Array.from({ length: 32 }, (_, seed) => seed), 42, 0xffffffff];
    for (const seed of seeds) {
      const ready = play(newMarket(seed), safeRun);
      expect(ready).toMatchObject({ credits: 24, rack: 0 });
      const complete = advance(ready, upgrade).state;
      expect(complete).toMatchObject({ credits: 11, rack: 1 });
      expect(RACK_CAPACITY[complete.rack]).toBe(5);
    }

    for (const [seed, sold, expectedLoss, remainingCredits] of [
      [7, 1, 'power-cell', 0],
      [42, 2, undefined, 10],
    ] as const) {
      const start = play(newMarket(seed), [buyCell, buyCell]);
      const exposed = advance(start, toRelay);
      expect(exposed.lost).toBe(expectedLoss);
      const actions = [toYard, ...Array.from({ length: sold }, () => sellCell), upgrade];
      expect(3 + actions.length).toBeLessThanOrEqual(7);
      expect(play(exposed.state, actions)).toMatchObject({ credits: remainingCredits, rack: 1 });
    }
  });

  it.each([7, 42])('replays the same input and shortcut outcomes from seed %i', (seed) => {
    const actions = [buyCell, toRelay, toQuay, toYard, travel('far-relay'), toQuay];
    function replay() {
      let state = newMarket(seed);
      return actions.map((action) => {
        const result = advance(state, action);
        state = result.state;
        return result;
      });
    }
    const first = replay();
    expect(first).toEqual(replay());
    expect(first[1]!.lost).toBe(seed === 7 ? 'power-cell' : undefined);
    expect(first.map(({ state }) => state.riskyTrips)).toEqual([0, 1, 2, 2, 2, 3]);
  });
});

function simpleCycles(path: readonly [Station, ...Station[]]): Station[][] {
  const [start] = path;
  return departures(path.at(-1)!).flatMap(({ to }) => {
    if (to === start) return path.length > 1 ? [[...path, start]] : [];
    return path.includes(to) ? [] : simpleCycles([...path, to]);
  });
}

describe('Relay Trader arbitrage search', () => {
  it('checks local trades, all simple cycles, their tolls and bounded sales at every stop', () => {
    const visited = new Set<string>();
    const losses = new Set<string>();
    const safePassages = new Set<string>();
    const rounds = STATIONS.flatMap((start) => simpleCycles([start]));

    // Three starts each have two two-edge returns and two directions around the triangle.
    expect(rounds.filter((path) => path.length === 3)).toHaveLength(6);
    expect(rounds.filter((path) => path.length === 4)).toHaveLength(6);

    for (const station of STATIONS) {
      for (const resource of RESOURCES) {
        const atMarket = { ...newMarket(42), location: station };
        const afterTrade = play(atMarket, [buy(resource), sell(resource)]);
        expect(afterTrade.credits).toBe(atMarket.credits - 2);
      }
    }

    for (const [start, ...stops] of rounds) {
      for (const resource of RESOURCES) {
        for (let units = 1; units <= RACK_CAPACITY[2]; units++) {
          for (const seed of [7, 42]) {
            // Preload a hold to exercise quantities up to the largest legal capacity.
            const state = newMarket(seed);
            state.location = start!;
            state.rack = 2;
            state.cargo[resource] = units;
            let current = state;
            for (const to of stops) {
              const edge = `${current.location}→${to}`;
              visited.add(edge);
              const route = departures(current.location).find((route) => route.to === to)!;
              const result = advance(current, travel(to));
              assert(route.toll > 0);
              assert.equal(current.credits - result.state.credits, route.toll);
              if (route.exposed) {
                assert.equal(result.state.riskyTrips, current.riskyTrips + 1);
                if (current.cargo[resource]) {
                  (result.lost ? losses : safePassages).add(edge);
                  assert.equal(
                    result.state.cargo[resource],
                    current.cargo[resource] - Number(!!result.lost),
                  );
                }
              } else {
                assert.equal(result.state.riskyTrips, current.riskyTrips);
                assert.equal(result.state.cargo[resource], current.cargo[resource]);
              }
              current = result.state;

              // At each stop, try all sale quantities as prefixes of the maximum legal sale.
              const quote = quoteMarket(current).find((quote) => quote.resource === resource)!;
              const sellable = Math.min(quote.demand, current.cargo[resource]);
              let selling = current;
              for (let sold = 1; sold <= sellable; sold++) {
                selling = advance(selling, sell(resource)).state;
                assert.equal(selling.credits, current.credits + sold * quote.sell);
                assert.equal(selling.quotas[to][resource].demand, quote.demand - sold);
              }
              assert.equal(applyMarketAction(selling, sell(resource)).accepted, false);
            }
            assert.equal(current.location, start);
            assert(current.credits < state.credits);
          }
        }
      }
    }
    const directed = ({ from, to }: (typeof ROUTES)[number]) => [`${from}→${to}`, `${to}→${from}`];
    expect(visited).toEqual(new Set(ROUTES.flatMap(directed)));
    const exposed = new Set(ROUTES.filter(({ exposed }) => exposed).flatMap(directed));
    expect(losses).toEqual(exposed);
    expect(safePassages).toEqual(exposed);
  });

  it('exhibits consecutive profitable safe circuits while quotas survive recovery and reload', () => {
    const start = newMarket(42);
    const circuit = [...safeRun, buy('coolant'), toQuay, sell('coolant')];
    let state = start;
    for (let runs = 1; runs <= 2; runs++) {
      const next = play(state, circuit);
      expect(next.credits - state.credits).toBe(11);
      expect(next.quotas['null-quay']['power-cell'].stock).toBe(6 - 2 * runs);
      expect(next.quotas.switchyard['power-cell'].demand).toBe(6 - 2 * runs);
      expect(next.quotas.switchyard.coolant.stock).toBe(6 - runs);
      expect(next.quotas['null-quay'].coolant.demand).toBe(3 - runs);
      state = next;
    }
    const reloaded = marketStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(reloaded).toEqual(state);
    expect(advance({ ...reloaded, credits: 0 }, recover).state.quotas).toEqual(state.quotas);
  });
});

function seedBoard(change?: (data: SaveData) => void) {
  let value: string | null = null;
  let refusing = false;
  const storage = {
    getItem: () => value,
    setItem: vi.fn((_key: string, text: string) => {
      if (refusing) throw new Error('Storage refused the checkpoint');
      value = text;
    }),
    removeItem: () => {
      value = null;
    },
  } satisfies SaveStorage;
  const data = freshSave(42);
  data.episodes.push('episode.000');
  data.profile.designation = 'OBS-02FF';
  data.flags.push('deferred-verified', 'spool-02-order-learned', 'spool-02-restored');
  data.doorState['other-door'] = { version: 2, payload: 'keep this slot' };
  change?.(data);
  expect(writeSave(storage, data)).toBe(true);
  return {
    storage,
    refuseWrites: (refuse: boolean) => {
      refusing = refuse;
    },
  };
}

async function openBoard(storage: SaveStorage) {
  const { data, persist, status } = openSaveSession(storage);
  expect(status).toBe('loaded');
  const settle = vi.fn((candidate: SaveData) => settleEvents(content.events, candidate));
  const host = createDoorHost(createDoorRegistry(content.doors), data, persist, settle);
  const bbs = createBbsDoorSession(getBbsOffer(content, factsOf(data))!, () => data, host);
  async function run(command: string) {
    return (await bbs.dispatch(command))!.output.flatMap(({ lines }) => lines);
  }
  const commands = () => bbs.screen().actions.map(({ command }) => command);
  await run('CONNECT');
  expect(await run('DESIGNATION')).toContain('SIGNED IN AS OBS-02FF');
  await run('DOORS');
  return { commands, data, run, settle };
}

function savedTrader(data: SaveData) {
  const slot = data.doorState['relay-trader'];
  assert(slot && typeof slot === 'object' && !Array.isArray(slot));
  expect(slot.version).toBe(1);
  return slot.payload as { market: MarketState; view: string; envelope: string };
}

function signedLines(lines: readonly string[]) {
  const start = lines.indexOf('SIGNED REPAIR MANIFEST R07-SPOOL-02');
  expect(start).toBeGreaterThanOrEqual(0);
  const signed = lines.slice(start, start + manifest.lines.length);
  expect(signed).toEqual(manifest.lines);
  return signed;
}

function expectSingleFlag(data: SaveData) {
  expect(data.flags.filter((id) => id === flag)).toEqual([flag]);
}

describe('Relay Trader in the shipped BBS', () => {
  it.each([false, true])(
    'refuses entry before restoration with manifest already held=%s',
    async (held) => {
      const { storage } = seedBoard((data) => {
        data.flags = data.flags.filter((id) => id !== 'spool-02-restored');
        if (held) data.flags.push(flag);
      });
      const board = await openBoard(storage);
      expect(board.commands()).not.toContain(openTrader);
      expect(await board.run(openTrader)).toContain('DOOR UNAVAILABLE.');
      expect(board.data.doorState).not.toHaveProperty('relay-trader');
      expect(board.settle).not.toHaveBeenCalled();
    },
  );

  it('exchanges the free envelope after reload and shares one reward with Hunter', async () => {
    const { storage } = seedBoard();
    const board = await openBoard(storage);
    expect(board.commands()).toContain(openTrader);
    expect(await board.run(openTrader)).toEqual(
      expect.arrayContaining([
        intro,
        'One repair manifest for proof of receipt, not value. Empty acknowledgement envelope reserved free for this Observer. Stamp ACK plus target node.',
        'Requisition: acknowledge SPOOL-02 for signed manifest R07-SPOOL-02.',
      ]),
    );
    expect(board.commands()).toContain('CLAIM ENVELOPE');
    expect(board.commands()).not.toContain('MANIFEST');
    expect(await board.run('EXCHANGE')).toContain(
      'Claim your free envelope before stamping or exchanging it.',
    );
    const start = savedTrader(board.data).market;
    expect(start).toEqual(newMarket(42));

    const claimed = await board.run('CLAIM ENVELOPE');
    expect(claimed).toContain('Empty acknowledgement envelope held.');
    expect(await board.run('CLAIM ENVELOPE')).toEqual(claimed);
    expect(board.commands()).toContain('STAMP ACK RELAY-07');
    expect(await board.run('STAMP ACK RELAY-07')).toContain(
      'The stamp names a different node. Correct it free at the desk.',
    );
    expect(await board.run('EXCHANGE')).toContain(
      'Exchange requires ACK SPOOL-02. The desk can correct a stamp for free.',
    );
    expect(board.commands()).toContain('STAMP ACK SPOOL-02');
    expect(await board.run('  stamp  ack spool-02  ')).toContain(
      'Envelope stamped ACK SPOOL-02. Ready for exchange.',
    );
    expect(savedTrader(board.data)).toEqual({ market: start, view: 'desk', envelope: 'stamped' });
    expect(board.data.flags).not.toContain(flag);
    expect(board.settle).not.toHaveBeenCalled();
    expect(await board.run('EXIT')).toContain('DEEP FIELD MAIN MENU');

    const resumed = await openBoard(storage);
    expect(await resumed.run(openTrader)).toContain(
      'Envelope stamped ACK SPOOL-02. Ready for exchange.',
    );
    storage.setItem.mockClear();
    const exchanged = await resumed.run('EXCHANGE');
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(exchanged).toContain(receipt);
    const signed = signedLines(exchanged);
    expectSingleFlag(resumed.data);
    expect(resumed.settle).toHaveBeenCalledOnce();
    expect(resumed.data.doorState).not.toHaveProperty('signal-hunter');
    expect(savedTrader(resumed.data)).toEqual({
      market: start,
      view: 'desk',
      envelope: 'exchanged',
    });
    expect(await resumed.run('EXCHANGE')).toEqual(exchanged);
    expect(signedLines(await resumed.run('MANIFEST'))).toEqual(signed);
    expect(resumed.settle).toHaveBeenCalledOnce();

    const reloaded = await openBoard(storage);
    expect(await reloaded.run(openTrader)).toContain(receipt);
    expect(signedLines(await reloaded.run('MANIFEST'))).toEqual(signed);
    await reloaded.run('EXIT');
    await reloaded.run('DOORS');
    await reloaded.run(openHunter);
    expect(signedLines(await reloaded.run('MANIFEST'))).toEqual(signed);
    expect(signedLines(await reloaded.run('VERIFY H3'))).toEqual(signed);
    expectSingleFlag(reloaded.data);
    expect(reloaded.settle).not.toHaveBeenCalled();
  });

  it('reads a Hunter award immediately, then retains a receipt without a second award', async () => {
    const { storage } = seedBoard();
    const board = await openBoard(storage);
    await board.run(openHunter);
    const signed = signedLines(await board.run('VERIFY H3'));
    expect(board.settle).toHaveBeenCalledOnce();
    expect(board.data.doorState).not.toHaveProperty('relay-trader');
    await board.run('EXIT');
    await board.run('DOORS');
    expect(await board.run(openTrader)).not.toContain(receipt);
    expect(board.commands()).toContain('MANIFEST');
    expect(signedLines(await board.run('MANIFEST'))).toEqual(signed);
    expect(savedTrader(board.data).envelope).toBe('reserved');

    await board.run('CLAIM ENVELOPE');
    await board.run('STAMP ACK SPOOL-02');
    expect(await board.run('EXCHANGE')).toContain(receipt);
    expectSingleFlag(board.data);
    expect(board.settle).toHaveBeenCalledOnce();

    const progress = { hasFact: (id: string) => id === fact };
    const direct = createRelayTraderDoor(42).restore(savedTrader(board.data), progress)!;
    expect(direct.checkpoint(progress).earnedRewards).toEqual([]);
    const reloaded = await openBoard(storage);
    expect(await reloaded.run(openTrader)).toContain(receipt);
    expect(signedLines(await reloaded.run('MANIFEST'))).toEqual(signed);
    expectSingleFlag(reloaded.data);
    expect(reloaded.settle).not.toHaveBeenCalled();
  });

  it('exchanges and corrects an envelope with zero credits, full cargo and depleted stock', async () => {
    const market = play(newMarket(42), [buyCell, buyCell, buyCell, toRelay, toYard]);
    market.quotas[market.location]['power-cell'].stock = 0;
    expect(market.credits).toBe(0);
    expect(cargoCount(market.cargo)).toBe(3);
    const { storage } = seedBoard((data) => {
      data.doorState['relay-trader'] = {
        version: 1,
        payload: { market, view: 'market', envelope: 'reserved' },
      };
    });
    const board = await openBoard(storage);
    await board.run(openTrader);
    expect(board.commands()).toContain('RECOVER');
    await board.run('DESK');
    await board.run('CLAIM ENVELOPE');
    await board.run('STAMP ACK RELAY-07');
    await board.run('STAMP ACK SPOOL-02');
    expect(await board.run('EXCHANGE')).toContain(receipt);
    expect(savedTrader(board.data).market).toEqual(market);
    expect(board.settle).toHaveBeenCalledOnce();
  });

  it('keeps the previous slot and facts on a refused exchange write and permits retry', async () => {
    const { storage, refuseWrites } = seedBoard();
    const board = await openBoard(storage);
    await board.run(openTrader);
    await board.run('CLAIM ENVELOPE');
    await board.run('STAMP ACK SPOOL-02');
    const before = storage.getItem();
    const dataBefore = structuredClone(board.data);
    refuseWrites(true);
    const refused = await board.run('EXCHANGE');
    expect(refused).toContain('DEEP FIELD MAIN MENU');
    expect(refused).not.toContain(receipt);
    expect(storage.getItem()).toBe(before);
    expect(board.data).toEqual(dataBefore);

    refuseWrites(false);
    const resumed = await openBoard(storage);
    expect(await resumed.run(openTrader)).toContain(
      'Envelope stamped ACK SPOOL-02. Ready for exchange.',
    );
    expect(await resumed.run('EXCHANGE')).toContain(receipt);
    expect(resumed.settle).toHaveBeenCalledOnce();
    expectSingleFlag(resumed.data);
    expect(savedTrader(resumed.data).envelope).toBe('exchanged');
  });

  it('restores the screen, market, envelope and next shortcut from serialized save bytes', async () => {
    const { storage } = seedBoard();
    const board = await openBoard(storage);
    await board.run(openTrader);
    await board.run('CLAIM ENVELOPE');
    await board.run('STAMP ACK SPOOL-02');
    const factsBefore = factsOf(board.data);
    expect(await board.run('MARKET')).toContain(
      'Goal: buy rack tier 1 (12/13 credits, capacity 5).',
    );
    for (const command of [
      'BUY POWER CELL',
      'BUY POWER CELL',
      'TRAVEL SWITCHYARD',
      'SELL POWER CELL',
      'SELL POWER CELL',
    ]) {
      expect(board.commands()).toContain(command);
      await board.run(command);
    }
    expect(savedTrader(board.data)).toMatchObject({
      market: { credits: 24, rack: 0 },
      envelope: 'stamped',
    });
    expect(board.commands()).toContain('UPGRADE');
    expect(await board.run('UPGRADE')).toContain('Goal complete: rack tier 1 installed.');
    expect(factsOf(board.data)).toEqual(factsBefore);
    expect(board.settle).not.toHaveBeenCalled();

    for (const command of ['TRAVEL NULL QUAY', 'BUY POWER CELL', 'BUY POWER CELL']) {
      await board.run(command);
    }
    const before = await board.run('TRAVEL FAR RELAY');
    const snapshot = structuredClone(savedTrader(board.data));
    expect(snapshot).toMatchObject({
      market: {
        location: 'far-relay',
        credits: 2,
        rack: 1,
        riskyTrips: 1,
        cargo: { 'power-cell': 2 },
      },
      view: 'market',
      envelope: 'stamped',
    });
    const savedCommands = board.commands();
    const resumed = await openBoard(storage);
    expect(await resumed.run(openTrader)).toEqual(before);
    expect(resumed.commands()).toEqual(savedCommands);
    expect(savedTrader(resumed.data)).toEqual(snapshot);
    expect(savedTrader(resumed.data).market).not.toBe(savedTrader(board.data).market);
    expect(await resumed.run('TRAVEL NULL QUAY')).toEqual(await board.run('TRAVEL NULL QUAY'));
    expect(savedTrader(resumed.data)).toEqual(savedTrader(board.data));
    expect(savedTrader(resumed.data).market.riskyTrips).toBe(2);
  });

  it('falls back from an invalid version-one payload while keeping the signed fact and other slots', async () => {
    const { storage } = seedBoard((data) => {
      data.flags.push(flag);
      data.doorState['relay-trader'] = {
        version: 1,
        payload: { market: { ...newMarket(7), credits: -1 }, view: 'market', envelope: 'empty' },
      };
    });
    const board = await openBoard(storage);
    expect(await board.run(openTrader)).toContain(intro);
    expect(signedLines(await board.run('MANIFEST'))).toEqual(manifest.lines);
    expectSingleFlag(board.data);
    expect(savedTrader(board.data)).toEqual({
      market: newMarket(42),
      view: 'desk',
      envelope: 'reserved',
    });
    expect(board.data.doorState['other-door']).toEqual({ version: 2, payload: 'keep this slot' });
    expect(board.settle).not.toHaveBeenCalled();
  });
});

describe('Relay Trader terminal controls', () => {
  const displayResources = { 'power-cell': 'POWER CELL', coolant: 'COOLANT', coil: 'COIL' };
  const displayStations = {
    'null-quay': 'NULL QUAY',
    switchyard: 'SWITCHYARD',
    'far-relay': 'FAR RELAY',
  };
  function commandFor(action: MarketAction) {
    if ('resource' in action)
      return `${action.kind.toUpperCase()} ${displayResources[action.resource]}`;
    if ('to' in action) return `TRAVEL ${displayStations[action.to]}`;
    return action.kind.toUpperCase();
  }

  it('dispatches each displayed market move through typed input with the quoted effects', () => {
    const start = newMarket(7);
    const fixtures = [
      start,
      play(start, [buyCell, buy('coolant'), toYard]),
      play(start, [buy('coil'), toYard]),
      play(start, safeRun),
      { ...play(start, safeRun), credits: 0 },
    ];
    const seen = new Set<string>();
    for (const market of fixtures) {
      const saved = { market, view: 'market', envelope: 'empty' };
      const lifecycle = createRelayTraderDoor(7);
      const moves = legalMarketActions(market);
      const commands = lifecycle
        .restore(saved, noFacts)!
        .screen.actions.map(({ command }) => command);
      expect(commands).toEqual([...moves.map(commandFor), 'NEW RUN', 'DESK']);
      for (const move of moves) {
        const command = commandFor(move);
        seen.add(command);
        const running = lifecycle.restore(saved, noFacts)!;
        const result = advance(market, move);
        const response = running.input(
          `  ${command.toLowerCase().replaceAll(' ', '  ')}  `,
          noFacts,
        );
        expect(running.checkpoint(noFacts).payload).toEqual({ ...saved, market: result.state });
        expect(response.lines).toContain(
          `Outpost: ${displayStations[result.state.location]} | Credits: ${result.state.credits} | Cargo: ${cargoCount(result.state.cargo)}/${RACK_CAPACITY[result.state.rack]}`,
        );
        if (move.kind === 'recover') {
          expect(response.lines).toContain(
            'Recovery tow to NULL QUAY. Balance restored to 12 credits.',
          );
        }
      }
    }
    expect(seen).toEqual(
      new Set([
        'BUY POWER CELL',
        'BUY COOLANT',
        'BUY COIL',
        'SELL POWER CELL',
        'SELL COOLANT',
        'SELL COIL',
        'TRAVEL NULL QUAY',
        'TRAVEL SWITCHYARD',
        'TRAVEL FAR RELAY',
        'UPGRADE',
        'RECOVER',
      ]),
    );
  });

  it('suspends trading at the desk and resets only the market after confirmation', async () => {
    const { storage } = seedBoard();
    const board = await openBoard(storage);
    await board.run(openTrader);
    await board.run('CLAIM ENVELOPE');
    await board.run('STAMP ACK SPOOL-02');
    await board.run('EXCHANGE');
    const facts = factsOf(board.data);
    await board.run('MARKET');
    for (const command of [
      'BUY POWER CELL',
      'BUY POWER CELL',
      'TRAVEL SWITCHYARD',
      'SELL POWER CELL',
      'SELL POWER CELL',
      'UPGRADE',
    ]) {
      await board.run(command);
    }
    const finished = savedTrader(board.data).market;
    expect(finished).toMatchObject({ credits: 11, rack: 1 });
    expect(finished.quotas['null-quay']['power-cell'].stock).toBe(4);
    expect(finished.quotas.switchyard['power-cell'].demand).toBe(4);
    expect(await board.run('DESK')).toContain(receipt);
    expect(savedTrader(board.data).market).toEqual(finished);
    await board.run('MARKET');
    expect(board.commands()).toContain('NEW RUN');
    expect(await board.run('CONFIRM NEW RUN')).toContain(
      'That action is unavailable here. Check cargo, credits, stock, demand and routes.',
    );
    expect(savedTrader(board.data).market).toEqual(finished);
    expect(await board.run('NEW RUN')).toContain(
      'Start a new market run? This resets your credits, cargo, racks and station quotas. Your desk progress stays with you.',
    );
    expect(board.commands()).toEqual(['CONFIRM NEW RUN', 'CANCEL', 'MANIFEST', 'DESK', 'EXIT']);
    await board.run('CANCEL');
    expect(savedTrader(board.data).market).toEqual(finished);
    await board.run('NEW RUN');
    expect(await board.run('CONFIRM NEW RUN')).toContain('New market run started.');
    expect(savedTrader(board.data)).toEqual({
      market: newMarket(42),
      view: 'market',
      envelope: 'exchanged',
    });
    expect(factsOf(board.data)).toEqual(facts);
    expect(board.settle).toHaveBeenCalledOnce();
    expect(signedLines(await board.run('MANIFEST'))).toEqual(manifest.lines);
    expect(await board.run('DESK')).toContain(receipt);
  });
});
