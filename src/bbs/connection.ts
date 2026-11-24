import type { Content } from '../content/schema.ts';
import { createDoorHost } from '../doors/host.ts';
import { createDoorRegistry } from '../doors/registry.ts';
import { settleEvents } from '../progress/events.ts';
import type { openSaveSession, SaveData } from '../progress/save.ts';
import type { Terminal } from '../terminal/terminal.ts';
import { createBbsScene } from './bbs-view.ts';
import type { BbsSay } from './bbs.ts';
import { createBbsDoorSession } from './door-session.ts';
import type { BbsOffer } from './offer.ts';
import { createBbsProgress } from './progress.ts';

interface Connection {
  root: HTMLElement;
  offer: BbsOffer;
  content: Pick<Content, 'doors' | 'events'>;
  session: Pick<ReturnType<typeof openSaveSession>, 'data' | 'persist'>;
  say: BbsSay;
  onSettings: (terminal: Terminal) => void;
  onDisconnect: () => void;
}

export function createBbsConnection({
  root,
  offer,
  content,
  session: { data, persist },
  say,
  onSettings,
  onDisconnect,
}: Connection) {
  const snapshot = () => data;
  const settle = (candidate: SaveData) => settleEvents(content.events, candidate);
  const host = createDoorHost(createDoorRegistry(content.doors), data, persist, settle);
  const progress = createBbsProgress(data, settle, persist);
  return createBbsScene(
    root,
    createBbsDoorSession(offer, snapshot, host, say),
    snapshot,
    progress.apply,
    progress.connect,
    onSettings,
    onDisconnect,
  );
}
