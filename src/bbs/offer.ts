import { evaluate, type Condition } from '../content/conditions.ts';
import type {
  Archive,
  BbsBoard,
  BbsMessage,
  BbsRecord,
  BbsThread,
  Content,
} from '../content/schema.ts';

export type Message = Pick<
  Archive,
  'title' | 'from' | 'date' | 'body' | 'origin' | 'presentation' | 'attribution'
> &
  Pick<BbsMessage, 'retainedModule' | 'sealedOriginals' | 'dispatchCopy'> & {
    key: string;
    requires?: Condition;
    eventOnly?: boolean;
  };
export type MessageBoard = Extract<BbsRecord, { kind: 'message-board' }>;
export type Profile = Extract<BbsRecord, { kind: 'profile' }>;
type Secret = Extract<BbsRecord, { kind: 'secret' }>;

export interface BbsOffer {
  board: BbsBoard;
  accessLevels: Content['accessLevels'];
  legacy: Message[];
  bulletins: Map<string, Message>;
  messages: Map<string, Message>;
  boards: MessageBoard[];
  threads: BbsThread[];
  profiles: Profile[];
  secrets: Secret[];
  artifacts: Content['artifacts'];
  characters: Content['characters'];
  sectors: Content['sectors'];
  repairManifests: Content['repairManifests'];
  initialFacts: ReadonlySet<string>;
}

export function getBbsOffer(
  content: Pick<
    Content,
    'bbs' | 'accessLevels' | 'archives' | 'artifacts' | 'characters' | 'sectors' | 'repairManifests'
  >,
  facts: ReadonlySet<string>,
): BbsOffer | undefined {
  const board = content.bbs.find(
    (entry) => entry.kind === 'board' && evaluate(entry.requires, facts),
  );
  if (!board || board.kind !== 'board') return;

  const messages = new Map<string, Message>();
  const addMessage = (key: string, message: Omit<Message, 'key'>) => {
    messages.set(key, { ...message, key });
  };
  for (const archive of content.archives) {
    if (!archive.searchOnly) addMessage(`archive:${archive.id}`, archive);
  }
  const legacy = board.archiveIds.flatMap((id) => messages.get(`archive:${id}`) ?? []);
  const bulletins = new Map<string, Message>();
  for (const entry of content.bbs) {
    if (entry.kind !== 'message') continue;
    const key = `message:${entry.id}`;
    addMessage(key, entry);
    if (entry.board !== board.id) continue;
    const message = messages.get(key)!;
    if (entry.eventOnly) bulletins.set(entry.id, message);
    else legacy.push(message);
  }

  const boards = content.bbs.filter(
    (entry): entry is MessageBoard => entry.kind === 'message-board' && entry.bbs === board.id,
  );
  const boardIds = new Set(boards.map((entry) => entry.id));
  const threads = content.bbs.filter(
    (entry): entry is BbsThread => entry.kind === 'thread' && boardIds.has(entry.board),
  );
  threads.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const profiles = content.bbs.filter(
    (entry): entry is Profile => entry.kind === 'profile' && entry.bbs === board.id,
  );
  const secrets = content.bbs.filter(
    (entry): entry is Secret => entry.kind === 'secret' && entry.bbs === board.id,
  );
  return {
    board,
    accessLevels: content.accessLevels,
    messages,
    legacy,
    bulletins,
    boards,
    threads,
    profiles,
    secrets,
    artifacts: content.artifacts.filter((artifact) => artifact.bbsBoard === board.id),
    characters: content.characters,
    sectors: content.sectors,
    repairManifests: content.repairManifests,
    initialFacts: facts,
  };
}
