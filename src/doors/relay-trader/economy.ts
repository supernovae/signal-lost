import { z } from 'zod';
import { mulberry32 } from '../../signal/rng.ts';

export const STATIONS = ['null-quay', 'switchyard', 'far-relay'] as const;
// Exposed trips jettison the first carried resource in this order.
export const RESOURCES = ['power-cell', 'coolant', 'coil'] as const;
const stationId = z.enum(STATIONS);
const resourceId = z.enum(RESOURCES);
export type Station = z.infer<typeof stationId>;
export type Resource = z.infer<typeof resourceId>;

export const MIN_PRICE = 1;
export const MAX_PRICE = 12;
export const START_CREDITS = 12;
export const RECOVERY_CREDITS = 12;
export const LOSS_CHANCE = 1 / 4;
export const RACK_CAPACITY = [3, 5, 7] as const;
export const RACK_UPGRADES = [{ tier: 1, cost: 13 }, { tier: 2, cost: 20 }, null] as const;

// Each entry is [reference price, initial stock, initial demand].
const markets = {
  'null-quay': {
    'power-cell': [2, 6, 1],
    coolant: [6, 2, 3],
    coil: [8, 2, 4],
  },
  switchyard: {
    'power-cell': [11, 1, 6],
    coolant: [3, 6, 1],
    coil: [5, 3, 3],
  },
  'far-relay': {
    'power-cell': [6, 2, 3],
    coolant: [8, 2, 5],
    coil: [3, 6, 1],
  },
} as const;

export const ROUTES = [
  { from: 'null-quay', to: 'switchyard', toll: 2, exposed: false },
  { from: 'switchyard', to: 'far-relay', toll: 2, exposed: false },
  { from: 'null-quay', to: 'far-relay', toll: 1, exposed: true },
] as const;

export function departures(location: Station) {
  return ROUTES.flatMap<{ to: Station; toll: number; exposed: boolean }>(
    ({ from, to, toll, exposed }) => {
      if (from === location) return [{ to, toll, exposed }];
      if (to === location) return [{ to: from, toll, exposed }];
      return [];
    },
  );
}

const unitCount = z.number().int().nonnegative();
const uint32 = unitCount.max(0xffffffff);
const quotas = z.record(
  stationId,
  z.record(resourceId, z.strictObject({ stock: unitCount, demand: unitCount })),
);
const startingQuotas = quotas.parse(
  Object.fromEntries(
    STATIONS.map((station) => [
      station,
      Object.fromEntries(
        RESOURCES.map((resource) => {
          const [, stock, demand] = markets[station][resource];
          return [resource, { stock, demand }];
        }),
      ),
    ]),
  ),
);
const initialDemand = STATIONS.reduce(
  (total, station) =>
    total + RESOURCES.reduce((demand, resource) => demand + markets[station][resource][2], 0),
  0,
);

export const marketStateSchema = z
  .strictObject({
    seed: uint32,
    riskyTrips: uint32,
    location: stationId,
    cargo: z.record(resourceId, unitCount),
    rack: z.literal([0, 1, 2]),
    credits: unitCount,
    quotas,
  })
  .refine(({ cargo, rack }) => cargoCount(cargo) <= RACK_CAPACITY[rack])
  .refine(({ quotas, credits }) => {
    let demandLeft = 0;
    for (const station of STATIONS) {
      for (const resource of RESOURCES) {
        const [, maxStock, maxDemand] = markets[station][resource];
        const { stock, demand } = quotas[station][resource];
        if (stock > maxStock || demand > maxDemand) return false;
        demandLeft += demand;
      }
    }
    // Each sale spends one demand unit, and recovery can bring credits up to the floor.
    return (
      credits + MAX_PRICE * demandLeft <=
      Math.max(START_CREDITS, RECOVERY_CREDITS) + MAX_PRICE * initialDemand
    );
  });

export type MarketState = z.infer<typeof marketStateSchema>;
export type MarketAction =
  | { kind: 'buy' | 'sell'; resource: Resource }
  | { kind: 'travel'; to: Station }
  | { kind: 'upgrade' | 'recover' };

export function cargoCount(cargo: Record<Resource, number>): number {
  return RESOURCES.reduce((count, resource) => count + cargo[resource], 0);
}

export function newMarket(seed: number): MarketState {
  return {
    seed: seed >>> 0,
    riskyTrips: 0,
    location: 'null-quay',
    cargo: { 'power-cell': 0, coolant: 0, coil: 0 },
    rack: 0,
    credits: START_CREDITS,
    quotas: structuredClone(startingQuotas),
  };
}

function quoteResource(state: MarketState, station: Station, resource: Resource) {
  const [reference] = markets[station][resource];
  return {
    resource,
    buy: reference + 1,
    sell: reference - 1,
    ...state.quotas[station][resource],
  };
}

export function quoteMarket(state: MarketState, station = state.location) {
  return RESOURCES.map((resource) => quoteResource(state, station, resource));
}

export function legalMarketActions(state: MarketState): MarketAction[] {
  const actions: MarketAction[] = [];
  const space = cargoCount(state.cargo) < RACK_CAPACITY[state.rack];
  for (const { resource, buy, stock, demand } of quoteMarket(state)) {
    if (space && stock > 0 && state.credits >= buy) actions.push({ kind: 'buy', resource });
    if (demand > 0 && state.cargo[resource] > 0) actions.push({ kind: 'sell', resource });
  }
  const routes = departures(state.location).filter(({ toll }) => toll <= state.credits);
  for (const { to } of routes) actions.push({ kind: 'travel', to });
  if (routes.length === 0) actions.push({ kind: 'recover' });
  const upgrade = RACK_UPGRADES[state.rack];
  if (upgrade && state.credits >= upgrade.cost) actions.push({ kind: 'upgrade' });
  return actions;
}

function sameAction(left: MarketAction, right: MarketAction) {
  if (left.kind !== right.kind) return false;
  if ('resource' in left) return 'resource' in right && left.resource === right.resource;
  if ('to' in left) return 'to' in right && left.to === right.to;
  return true;
}

type MarketResult =
  { accepted: false; state: MarketState } | { accepted: true; state: MarketState; lost?: Resource };

export function applyMarketAction(state: MarketState, action: MarketAction): MarketResult {
  if (!legalMarketActions(state).some((legal) => sameAction(legal, action))) {
    return { accepted: false, state };
  }

  const next = structuredClone(state);
  switch (action.kind) {
    case 'buy':
    case 'sell': {
      const { resource } = action;
      const { buy, sell } = quoteResource(state, state.location, resource);
      const quota = next.quotas[next.location][resource];
      if (action.kind === 'buy') {
        next.credits -= buy;
        next.cargo[resource]++;
        quota.stock--;
      } else {
        next.credits += sell;
        next.cargo[resource]--;
        quota.demand--;
      }
      break;
    }
    case 'travel': {
      const { toll, exposed } = departures(state.location).find(({ to }) => to === action.to)!;
      next.credits -= toll;
      next.location = action.to;
      if (exposed) {
        const seed = (state.seed + Math.imul(state.riskyTrips, 0x9e3779b9)) >>> 0;
        next.riskyTrips = (state.riskyTrips + 1) >>> 0;
        if (mulberry32(seed)() < LOSS_CHANCE) {
          const lost = RESOURCES.find((resource) => next.cargo[resource] > 0);
          if (lost) {
            next.cargo[lost]--;
            return { accepted: true, state: next, lost };
          }
        }
      }
      break;
    }
    case 'upgrade': {
      const upgrade = RACK_UPGRADES[state.rack]!;
      next.credits -= upgrade.cost;
      next.rack = upgrade.tier;
      break;
    }
    case 'recover':
      next.location = 'null-quay';
      next.credits = RECOVERY_CREDITS;
      break;
  }
  return { accepted: true, state: next };
}
