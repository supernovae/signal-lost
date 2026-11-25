import { z } from 'zod';
import { fill } from '../../bbs/copy.ts';
import { manifest, manifestFact, parseDoorContent } from '../code-door-content.ts';
import { defineDoor, type DoorProgress, type DoorScreen } from '../contract.ts';
import {
  applyMarketAction,
  cargoCount,
  departures,
  legalMarketActions,
  LOSS_CHANCE,
  marketStateSchema,
  newMarket,
  quoteMarket,
  RACK_CAPACITY,
  RACK_UPGRADES,
  RECOVERY_CREDITS,
  RESOURCES,
  ROUTES,
  STATIONS,
  type MarketAction,
  type MarketState,
  type Station,
} from './economy.ts';

const assets = import.meta.glob<string>('/content/code-doors/relay-trader.jsonc', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const line = z.string().min(1);
const resourceNames = z.record(z.enum(RESOURCES), line);
const copy = z
  .strictObject({
    stations: z.record(z.enum(STATIONS), z.strictObject({ name: line, reasons: resourceNames })),
    resources: resourceNames,
    desk: z.strictObject({
      intro: line,
      rule: line,
      requisition: line,
      reserved: line,
      empty: line,
      mistamped: line,
      stamped: line,
      exchanged: line,
      unclaimed: line,
      needsStamp: line,
      invalidStamp: line,
      wrongStampNode: line,
      held: line,
      unavailable: line,
      help: line,
    }),
    market: z.strictObject({
      tip: line,
      priceRule: line,
      rejected: line,
      restartPrompt: line,
      restarted: line,
    }),
  })
  .parse(parseDoorContent(assets['/content/code-doors/relay-trader.jsonc']!));

const saveState = z.strictObject({
  market: marketStateSchema,
  view: z.enum(['desk', 'market']),
  envelope: z.enum(['reserved', 'empty', 'mistamped', 'stamped', 'exchanged']),
});
type Saved = z.infer<typeof saveState>;
type State = { saved: Saved; confirming?: boolean };

const action = (command: string, label: string) => ({ command, label });
const openMarket = action('MARKET', 'Open market');
const openDesk = action('DESK', 'Return to acknowledgement desk');
const readManifest = action('MANIFEST', 'Read manifest');
const claim = action('CLAIM ENVELOPE', 'Claim free envelope');
const stamp = `ACK ${manifest.target}`;
const correctStamp = action(`STAMP ${stamp}`, `Stamp ${stamp}`);
const wrongStamp = action(
  `STAMP ACK ${copy.desk.wrongStampNode}`,
  `Stamp ACK ${copy.desk.wrongStampNode}`,
);
const exchange = action('EXCHANGE', 'Exchange envelope');
const readReceipt = action('EXCHANGE', 'Read exchange receipt');
const newRun = action('NEW RUN', 'Start new market run');
const confirmRun = action('CONFIRM NEW RUN', 'Confirm new market run');
const cancelRun = action('CANCEL', 'Keep current market run');

const stationName = (station: Station) => copy.stations[station].name;
const deskText = (template: string) =>
  fill(template, { node: manifest.target, manifest: manifest.id, stamp });

function canReadManifest(saved: Saved, progress: DoorProgress): boolean {
  return saved.envelope === 'exchanged' || progress.hasFact(manifestFact);
}

function deskScreen(saved: Saved, progress: DoorProgress): DoorScreen {
  const { envelope } = saved;
  const held = canReadManifest(saved, progress);
  return {
    lines: [
      'RELAY TRADER',
      copy.desk.intro,
      copy.desk.rule,
      deskText(copy.desk.requisition),
      deskText(copy.desk[envelope]),
      ...(held ? [copy.desk.held] : []),
    ],
    actions: [
      ...(envelope === 'exchanged' ? [readReceipt] : [claim, exchange]),
      ...(envelope === 'reserved' || envelope === 'exchanged' ? [] : [correctStamp, wrongStamp]),
      ...(held ? [readManifest] : []),
      openMarket,
    ],
  };
}

function marketControl(move: MarketAction, market: MarketState) {
  switch (move.kind) {
    case 'buy':
    case 'sell': {
      const name = copy.resources[move.resource];
      const verb = move.kind === 'buy' ? 'Buy' : 'Sell';
      return action(`${verb.toUpperCase()} ${name.toUpperCase()}`, `${verb} ${name}`);
    }
    case 'travel':
      return action(`TRAVEL ${stationName(move.to)}`, `Travel to ${stationName(move.to)}`);
    case 'upgrade':
      return action('UPGRADE', `Buy rack tier ${RACK_UPGRADES[market.rack]!.tier}`);
    case 'recover':
      return action('RECOVER', 'Request recovery tow');
  }
}

function marketScreen(state: State, progress: DoorProgress): DoorScreen {
  const { saved, confirming } = state;
  const { market } = saved;
  const capacity = RACK_CAPACITY[market.rack];
  const upgrade = RACK_UPGRADES[market.rack];
  const { location } = market;
  return {
    lines: [
      'RELAY TRADER MARKET',
      `Outpost: ${stationName(location)} | Credits: ${market.credits} | Cargo: ${cargoCount(market.cargo)}/${capacity}`,
      `Hold: ${RESOURCES.map((resource) => `${copy.resources[resource]} ×${market.cargo[resource]}`).join(', ')}`,
      market.rack === 0
        ? `Goal: buy rack tier 1 (${market.credits}/${RACK_UPGRADES[0].cost} credits, capacity ${RACK_CAPACITY[1]}).`
        : 'Goal complete: rack tier 1 installed.',
      `Current rack tier: ${market.rack}.`,
      ...(upgrade && market.rack > 0
        ? [
            `Rack tier ${upgrade.tier}: ${upgrade.cost} credits, capacity ${RACK_CAPACITY[upgrade.tier]}.`,
          ]
        : []),
      ...(market.rack === 0 ? [copy.market.tip] : []),
      copy.market.priceRule,
      ...quoteMarket(market).map(
        ({ resource, buy, sell, stock, demand }) =>
          `${copy.resources[resource]} | Buy ${buy} | Sell ${sell} | Stock ${stock} | Demand ${demand} | ${copy.stations[location].reasons[resource]}`,
      ),
      `Map: ${ROUTES.map(({ from, to, exposed }) => `${stationName(from)} ↔ ${stationName(to)} (${exposed ? 'shortcut' : 'safe'})`).join(' | ')}`,
      ...departures(location).map(
        ({ to, toll, exposed }) =>
          `${stationName(to)} | Toll ${toll} | ${exposed ? `Shortcut: 1 in ${1 / LOSS_CHANCE} chance to lose one carried unit.` : 'Safe passage.'}`,
      ),
      `Loss order: ${RESOURCES.map((resource) => copy.resources[resource]).join(', ')}.`,
      ...(confirming ? [copy.market.restartPrompt] : []),
    ],
    actions: [
      ...(confirming
        ? [confirmRun, cancelRun]
        : [...legalMarketActions(market).map((move) => marketControl(move, market)), newRun]),
      ...(canReadManifest(saved, progress) ? [readManifest] : []),
      openDesk,
    ],
  };
}

function deskInput(saved: Saved, command: string): readonly string[] {
  const { envelope } = saved;
  if (envelope === 'exchanged' && (command === 'EXCHANGE' || command === claim.command)) {
    return manifest.lines;
  }
  if (command === claim.command) {
    if (envelope === 'reserved') saved.envelope = 'empty';
    return [];
  }
  if (command === 'EXCHANGE') {
    if (envelope === 'reserved') return [copy.desk.unclaimed];
    if (envelope !== 'stamped') return [deskText(copy.desk.needsStamp)];
    saved.envelope = 'exchanged';
    return manifest.lines;
  }
  if (command.startsWith('STAMP ')) {
    if (envelope === 'reserved') return [copy.desk.unclaimed];
    if (envelope === 'exchanged') return manifest.lines;
    if (command === correctStamp.command) saved.envelope = 'stamped';
    else if (/^STAMP ACK \S+$/.test(command)) saved.envelope = 'mistamped';
    else return [copy.desk.invalidStamp];
    return [];
  }
  return [copy.desk.help];
}

function marketInput(state: State, command: string): readonly string[] {
  const { saved } = state;
  const { market } = saved;
  if (command === confirmRun.command && state.confirming) {
    state.confirming = false;
    saved.market = newMarket(market.seed);
    return [copy.market.restarted];
  }
  state.confirming = command === newRun.command;
  if (state.confirming || command === cancelRun.command) return [];
  const move = legalMarketActions(market).find(
    (move) => marketControl(move, market).command === command,
  );
  if (!move) return [copy.market.rejected];
  const result = applyMarketAction(market, move);
  if (!result.accepted) return [copy.market.rejected];
  saved.market = result.state;
  if (result.lost) return [`Shortcut loss: one ${copy.resources[result.lost]}.`];
  if (move.kind === 'recover') {
    return [
      `Recovery tow to ${stationName(result.state.location)}. Balance restored to ${RECOVERY_CREDITS} credits.`,
    ];
  }
  return [];
}

export function createRelayTraderDoor(saveSeed: number) {
  function show(state: State, progress: DoorProgress, details: readonly string[] = []) {
    const screen =
      state.saved.view === 'desk'
        ? deskScreen(state.saved, progress)
        : marketScreen(state, progress);
    return { state, screen: { lines: [...screen.lines, ...details], actions: screen.actions } };
  }

  return defineDoor<State, Saved>({
    saveState,
    launch: (progress) =>
      show(
        { saved: { market: newMarket(saveSeed), view: 'desk', envelope: 'reserved' } },
        progress,
      ),
    restore: (saved, progress) => show({ saved }, progress),
    input(state, value, progress) {
      const command = value.trim().replace(/\s+/g, ' ').toUpperCase();
      const { saved } = state;
      if (command === openMarket.command || command === openDesk.command) {
        saved.view = command === openMarket.command ? 'market' : 'desk';
        state.confirming = false;
        return show(state, progress);
      }
      if (command === readManifest.command) {
        return show(
          state,
          progress,
          canReadManifest(saved, progress) ? manifest.lines : [copy.desk.unavailable],
        );
      }
      const details =
        saved.view === 'desk' ? deskInput(saved, command) : marketInput(state, command);
      return show(state, progress, details);
    },
    exit() {},
    save: ({ saved }) => saved,
    earnedRewards: (saved, progress) =>
      saved.envelope === 'exchanged' && !progress.hasFact(manifestFact) ? [manifestFact] : [],
  });
}
