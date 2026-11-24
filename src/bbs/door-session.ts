import type { DoorScreen } from '../doors/contract.ts';
import type { DoorHost, DoorResult } from '../doors/host.ts';
import { createBbs } from './bbs.ts';

/** Routes the shared terminal to a door while the BBS keeps the player's sign-in. */
export function createBbsDoorSession(
  offer: Parameters<typeof createBbs>[0],
  identity: Parameters<typeof createBbs>[1],
  host: DoorHost,
) {
  const bbs = createBbs(offer, identity, host);
  let doorScreen: DoorScreen | undefined;
  let opening = false;

  function screen() {
    if (!doorScreen) return bbs.screen();
    return {
      phase: 'door' as const,
      hint: 'TYPE EXIT TO RETURN TO THE MAIN MENU.',
      actions: [...doorScreen.actions, { command: 'EXIT', label: 'EXIT' }],
    };
  }

  function show(result: DoorResult): ReturnType<typeof bbs.dispatch> {
    if (result.kind === 'screen') {
      doorScreen = result.screen;
      return { output: { tone: 'system', lines: [...doorScreen.lines, screen().hint] } };
    }
    doorScreen = undefined;
    if (result.kind === 'unavailable') {
      return { output: { tone: 'system', lines: ['DOOR UNAVAILABLE.', bbs.screen().hint] } };
    }
    const menu = bbs.dispatch('MENU');
    if (result.kind === 'exit') return menu;
    const error = offer.board.doorError ?? 'DOOR CARRIER LOST. BACK AT THE BOARD.';
    return { output: { tone: 'system', lines: [error, ...menu.output.lines] } };
  }

  async function dispatch(command: string): Promise<ReturnType<typeof bbs.dispatch> | undefined> {
    if (opening) return;
    if (doorScreen) {
      return show(command.trim().toUpperCase() === 'EXIT' ? host.exit() : host.input(command));
    }
    const result = bbs.dispatch(command);
    if (!result.opensDoor) return result;
    opening = true;
    try {
      return show(await host.launch(result.opensDoor));
    } finally {
      opening = false;
    }
  }

  return { screen, dispatch };
}

export type BbsDoorSession = ReturnType<typeof createBbsDoorSession>;
