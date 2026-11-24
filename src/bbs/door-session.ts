import type { DoorScreen } from '../doors/contract.ts';
import type { DoorHost, DoorResult } from '../doors/host.ts';
import { createBbs, type BbsAction, type DispatchResult } from './bbs.ts';
import { bbsCopy } from './copy.ts';

const { actions, text } = bbsCopy;

/** Routes the shared terminal to a door while the BBS keeps the player's sign-in. */
export function createBbsDoorSession(
  offer: Parameters<typeof createBbs>[0],
  snapshot: Parameters<typeof createBbs>[1],
  host: DoorHost,
) {
  const bbs = createBbs(offer, snapshot, host);
  let doorScreen: DoorScreen | undefined;
  let opening = false;

  function screen(): {
    phase: ReturnType<typeof bbs.screen>['phase'] | 'door';
    hint: string;
    actions: BbsAction[];
  } {
    if (!doorScreen) return bbs.screen();
    return {
      phase: 'door' as const,
      hint: text.doorHint,
      actions: [...doorScreen.actions, { command: 'EXIT', label: actions.EXIT }],
    };
  }

  function show(result: DoorResult): DispatchResult {
    if (result.kind === 'screen') {
      doorScreen = result.screen;
      return { output: [{ tone: 'door', lines: [...doorScreen.lines, screen().hint] }] };
    }
    doorScreen = undefined;
    if (result.kind === 'unavailable') {
      return { output: [{ tone: 'restricted', lines: [text.doorUnavailable, bbs.screen().hint] }] };
    }
    const menu = bbs.dispatch('MENU');
    if (result.kind === 'exit') return menu;
    const error = offer.board.doorError ?? text.doorError;
    return { output: [{ tone: 'network-error', lines: [error] }, ...menu.output] };
  }

  async function dispatch(command: string): Promise<DispatchResult | undefined> {
    if (opening) return;
    if (doorScreen) {
      return show(command.trim().toUpperCase() === 'EXIT' ? host.exit() : host.input(command));
    }
    const result = bbs.dispatch(command);
    const id = result.opensDoor;
    if (!id) return result;
    opening = true;
    try {
      const launched = await host.launch(id);
      const next = show(launched);
      return launched.kind === 'screen'
        ? { ...next, effect: { history: { kind: 'door', id } } }
        : next;
    } finally {
      opening = false;
    }
  }

  return { screen, dispatch };
}

export type BbsDoorSession = ReturnType<typeof createBbsDoorSession>;
