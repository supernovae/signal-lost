import { loadBundledBbsContent } from '../content/bbs-browser.ts';
import type { Content } from '../content/schema.ts';
import { createDoorHost } from '../doors/host.ts';
import { createDoorRegistry } from '../doors/registry.ts';
import { createDialogueSources } from '../narrative/dialogue.ts';
import { settleEvents } from '../progress/events.ts';
import type { openSaveSession, SaveData } from '../progress/save.ts';
import type { Game } from '../puzzle/game.ts';
import type { Terminal } from '../terminal/terminal.ts';
import { createBbsScene } from './bbs-view.ts';
import type { DispatchResult } from './bbs.ts';
import { createBbsDoorSession } from './door-session.ts';
import { getBbsOffer } from './offer.ts';
import { createBbsProgress } from './progress.ts';

interface Connection {
  root: HTMLElement;
  shared: Pick<Content, 'accessLevels' | 'archives' | 'artifacts' | 'sectors'>;
  facts: ReadonlySet<string>;
  session: Pick<ReturnType<typeof openSaveSession>, 'data' | 'persist'>;
  say: Game['say'];
  onSettings: (terminal: Terminal) => void;
  onDisconnect: () => void;
  onCompletion: (completion: NonNullable<DispatchResult['completion']>) => void;
}

export function createBbsConnection({
  root,
  shared,
  facts,
  session: { data, persist },
  say,
  onSettings,
  onDisconnect,
  onCompletion,
}: Connection) {
  const content = loadBundledBbsContent();
  const offer = getBbsOffer({ ...shared, ...content }, facts);
  if (!offer) throw new Error('No eligible BBS endpoint');
  const voices = createDialogueSources(content.characters);
  const snapshot = () => data;
  const settle = (candidate: SaveData) => settleEvents(content.events, candidate);
  const host = createDoorHost(createDoorRegistry(content.doors), data, persist, settle);
  const progress = createBbsProgress(data, settle, persist, content.episodes);
  const sayOnBbs = (characterId: string) => {
    const voice = voices.get(characterId);
    return voice && say(voice, 'bbs');
  };
  return createBbsScene(
    root,
    createBbsDoorSession(offer, snapshot, host, sayOnBbs, progress.applyCompletion),
    snapshot,
    progress.apply,
    progress.connect,
    onSettings,
    onDisconnect,
    onCompletion,
  );
}
