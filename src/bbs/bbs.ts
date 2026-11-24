import { evaluate, type Condition } from '../content/conditions.ts';
import type {
  Archive,
  BbsBoard,
  BbsRecord,
  BbsThread,
  BbsTone,
  Content,
  DialogueLine,
} from '../content/schema.ts';
import type { DoorListing } from '../doors/registry.ts';
import { deriveAccessLevel, hasAccessLevel } from '../progress/access.ts';
import { normalizeHandle } from '../progress/save.ts';
import { mapNodes } from '../world/map.ts';
import { bbsCopy, fill, messageCredit } from './copy.ts';
import type { BbsEffect, BbsHistoryEntry, BbsSnapshot } from './progress.ts';

type Message = Pick<
  Archive,
  'title' | 'from' | 'date' | 'body' | 'origin' | 'presentation' | 'attribution'
> & {
  key: string;
  requires?: Condition;
  eventOnly?: boolean;
};
type MessageBoard = Extract<BbsRecord, { kind: 'message-board' }>;
type Profile = Extract<BbsRecord, { kind: 'profile' }>;
type Secret = Extract<BbsRecord, { kind: 'secret' }>;

interface BbsOffer {
  board: BbsBoard;
  accessLevels: Content['accessLevels'];
  legacy: Message[];
  bulletins: Map<string, Message>;
  messages: Map<string, Message>;
  boards: MessageBoard[];
  threads: BbsThread[];
  profiles: Profile[];
  secrets: Secret[];
  characters: Content['characters'];
  sectors: Content['sectors'];
  initialFacts: ReadonlySet<string>;
}

export function getBbsOffer(content: Content, facts: ReadonlySet<string>): BbsOffer | undefined {
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
    characters: content.characters,
    sectors: content.sectors,
    initialFacts: facts,
  };
}

type Route =
  | {
      phase:
        | 'offline'
        | 'login'
        | 'menu'
        | 'messages'
        | 'message'
        | 'sysop'
        | 'boards'
        | 'people'
        | 'directory'
        | 'network'
        | 'history';
    }
  | { phase: 'doors'; parent: 'directory' | 'menu' }
  | { phase: 'board'; board: MessageBoard }
  | { phase: 'profile'; profile: Profile }
  | { phase: 'thread'; thread: BbsThread; board: MessageBoard };

export interface BbsOutput {
  tone: BbsTone;
  lines: readonly string[];
  origin?: Message['origin'];
  credit?: string;
}

export interface BbsAction {
  command: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
}

interface Screen {
  phase: Route['phase'];
  hint: string;
  actions: BbsAction[];
}

export interface DispatchResult {
  output: BbsOutput[];
  effect?: BbsEffect;
  opensDoor?: string;
  opensSettings?: boolean;
}

interface BbsDoors {
  list(): readonly DoorListing[];
  facts(): ReadonlySet<string>;
}

export type BbsSay = (characterId: string) => DialogueLine | undefined;

const { actions: labels, text } = bbsCopy;
const actionButton = (command: keyof typeof labels, label = labels[command]): BbsAction => ({
  command,
  label,
});
const link = (verb: string, id: string, label: string): BbsAction => ({
  command: `${verb} ${id}`,
  label,
});
const sessionActions = [actionButton('HELP'), actionButton('DISCONNECT')];

function messageOutput(message: Message): BbsOutput {
  return {
    tone: message.presentation,
    lines: [
      message.title,
      fill(text.from, { name: message.from }),
      fill(text.date, { date: message.date }),
      ...message.body,
    ],
    origin: message.origin,
    credit: messageCredit(message.attribution),
  };
}

function system(...lines: string[]): DispatchResult {
  return { output: [{ tone: 'system', lines }] };
}

export function createBbs(
  offer: BbsOffer,
  snapshot: () => BbsSnapshot,
  doors?: BbsDoors,
  say?: BbsSay,
) {
  const { board, boards, threads, profiles, secrets, messages, accessLevels } = offer;
  const facts = () => doors?.facts() ?? offer.initialFacts;
  let route: Route = { phase: 'offline' };

  const visibleMessages = () => {
    const current = facts();
    return [
      ...offer.legacy.filter((message) => evaluate(message.requires, current)),
      ...snapshot().events.bulletins.flatMap((id) => offer.bulletins.get(id) ?? []),
    ];
  };
  const visiblePosts = (thread: BbsThread) => {
    const current = facts();
    return thread.messages.flatMap(({ kind, id }) => {
      const post = messages.get(`${kind}:${id}`);
      return post && evaluate(post.requires, current) ? [post] : [];
    });
  };
  const visibleThreads = (boardId: string) =>
    threads.filter((thread) => thread.board === boardId && visiblePosts(thread).length);
  const selectedReply = (thread: BbsThread) => {
    const choice = snapshot().bbs.replies[thread.id];
    return thread.replies.find((reply) => reply.id === choice);
  };
  const findCharacter = (id: string) => offer.characters.find((character) => character.id === id);
  const canTalk = (profile: Profile) =>
    Boolean(say && findCharacter(profile.characterId)?.lines.some((line) => line.kind === 'bbs'));

  function screen(): Screen {
    const { phase } = route;
    const view = (actions: BbsAction[], hint = text.viewHint): Screen => ({
      phase,
      hint,
      actions: [...actions, actionButton('BACK'), actionButton('MENU'), ...sessionActions],
    });
    switch (route.phase) {
      case 'offline':
        return { phase, hint: board.notice, actions: [actionButton('CONNECT')] };
      case 'login': {
        const { designation } = snapshot().profile;
        return {
          phase,
          hint: designation ? text.loginHint : text.customHint,
          actions: [
            ...(designation
              ? [actionButton('DESIGNATION', fill(labels.DESIGNATION, { designation }))]
              : []),
            actionButton('LOGIN'),
            ...sessionActions,
          ],
        };
      }
      case 'menu':
        return {
          phase,
          hint: text.menuHint,
          actions: [
            actionButton('BOARDS'),
            actionButton('MESSAGES'),
            actionButton('SYSOP'),
            actionButton('PEOPLE'),
            actionButton('DIRECTORY'),
            ...(doors ? [actionButton('DOORS')] : []),
            actionButton('HISTORY'),
            actionButton('SETTINGS'),
            ...sessionActions,
          ],
        };
      case 'doors': {
        const available = doors?.list() ?? [];
        return view(
          available.map(({ id, name }) => link('OPEN', id, name)),
          available.length ? text.doorsHint : text.noDoors,
        );
      }
      case 'messages': {
        const entries = visibleMessages();
        const read = new Set(snapshot().bbsReadMessages);
        return view(
          entries.map((entry, i) => {
            const unread = entry.eventOnly ? text.newItem : text.unread;
            return link(
              'READ',
              String(i + 1),
              fill(text.marked, {
                title: entry.title,
                state: read.has(entry.key) ? text.read : unread,
              }),
            );
          }),
          entries.length ? text.messagesHint : text.noMessages,
        );
      }
      case 'boards':
        return view(boards.map(({ id, title }) => link('BOARD', id, title)));
      case 'board':
        return view(
          visibleThreads(route.board.id).map(({ id, title }) => link('THREAD', id, title)),
        );
      case 'thread': {
        if (!visiblePosts(route.thread).length) return view([]);
        const selected = selectedReply(route.thread);
        return view(
          route.thread.replies.map(({ id, label }) => ({
            ...link('REPLY', id, label),
            selected: selected?.id === id,
            disabled: Boolean(selected),
          })),
        );
      }
      case 'people':
        return view(profiles.map(({ id, handle }) => link('PROFILE', id, handle)));
      case 'profile':
        return view(canTalk(route.profile) ? [actionButton('TALK')] : []);
      case 'directory':
        return view([...(doors ? [actionButton('DOORS')] : []), actionButton('NETWORK')]);
      default:
        return view([]);
    }
  }

  function enter(next: Route, ...output: BbsOutput[]): DispatchResult {
    route = next;
    const heading = output[0];
    if (heading?.tone === 'system') heading.lines = [...heading.lines, screen().hint];
    return { output };
  }

  function menu(): DispatchResult {
    const currentFacts = facts();
    const level = deriveAccessLevel(accessLevels, currentFacts);
    return enter(
      { phase: 'menu' },
      {
        tone: 'system',
        lines: [
          fill(text.title, { title: board.title }),
          ...(level ? [fill(text.accessLevel, { level: level.label })] : []),
          ...board.status
            .filter(({ when }) => evaluate(when, currentFacts))
            .map(({ text }) => text),
        ],
      },
    );
  }

  function section(next: Route, heading: string, ...lines: string[]): DispatchResult {
    return enter(next, {
      tone: 'system',
      lines: [fill(text.section, { title: board.title, section: heading }), ...lines],
    });
  }

  function showBoard(next: MessageBoard): DispatchResult {
    const available = visibleThreads(next.id).length > 0;
    return enter(
      { phase: 'board', board: next },
      {
        tone: 'system',
        lines: [next.title, ...next.description, ...(available ? [] : [text.noThreads])],
      },
    );
  }

  function back(): DispatchResult {
    switch (route.phase) {
      case 'board':
        return section({ phase: 'boards' }, labels.BOARDS);
      case 'thread':
        return showBoard(route.board);
      case 'profile':
        return section({ phase: 'people' }, labels.PEOPLE);
      case 'message':
        return section({ phase: 'messages' }, labels.MESSAGES);
      case 'network':
        return section({ phase: 'directory' }, labels.DIRECTORY);
      case 'doors':
        if (route.parent === 'directory') return section({ phase: 'directory' }, labels.DIRECTORY);
        return menu();
      default:
        return menu();
    }
  }

  function historyLine(entry: BbsHistoryEntry): string {
    const findThread = (id: string) => threads.find((thread) => thread.id === id);
    let title: string | undefined;
    let choice: string | undefined;
    switch (entry.kind) {
      case 'board':
        title = boards.find(({ id }) => id === entry.id)?.title;
        break;
      case 'thread':
        title = findThread(entry.id)?.title;
        break;
      case 'read':
        title = messages.get(entry.id)?.title;
        break;
      case 'profile':
        title = profiles.find(({ id }) => id === entry.id)?.handle;
        break;
      case 'door':
        title = doors?.list().find(({ id }) => id === entry.id)?.name;
        break;
      case 'secret':
        title = secrets.find(({ id }) => id === entry.id)?.command;
        break;
      case 'reply': {
        const thread = findThread(entry.id);
        title = thread?.title;
        choice = thread?.replies.find(({ id }) => id === entry.choice)?.label;
        break;
      }
    }
    return fill(bbsCopy.history[entry.kind], {
      title: title ?? text.removed,
      choice: choice ?? text.removed,
    });
  }

  function signIn(handle: string, changedHandle?: string): DispatchResult {
    const result = menu();
    result.output.unshift({ tone: 'system', lines: [fill(text.connected, { handle })] });
    return withHistory(
      result,
      { kind: 'sign-in' },
      changedHandle === undefined ? {} : { handle: changedHandle },
    );
  }

  function withHistory(
    result: DispatchResult,
    history: BbsHistoryEntry,
    delta: Omit<BbsEffect, 'history'> = {},
  ): DispatchResult {
    return { ...result, effect: { history, ...delta } };
  }

  function fromMenu(action: string): DispatchResult | undefined {
    switch (action) {
      case 'BOARDS':
        return section({ phase: 'boards' }, labels.BOARDS);
      case 'MESSAGES':
        return section({ phase: 'messages' }, labels.MESSAGES);
      case 'SYSOP': {
        route = { phase: 'sysop' };
        const line = board.sysopCharacterId ? say?.(board.sysopCharacterId) : undefined;
        const lines = line?.text ?? board.sysopGreeting ?? [text.noDialogue];
        return { output: [{ tone: 'sysop', lines, origin: 'fictional' }] };
      }
      case 'PEOPLE':
        return section({ phase: 'people' }, labels.PEOPLE);
      case 'DIRECTORY':
        return withHistory(section({ phase: 'directory' }, labels.DIRECTORY), {
          kind: 'directory',
        });
      case 'HISTORY': {
        const lines = snapshot().bbs.history.map(historyLine);
        return section(
          { phase: 'history' },
          labels.HISTORY,
          ...(lines.length ? lines : [text.emptyHistory]),
        );
      }
      case 'SETTINGS':
        return { output: [], opensSettings: true };
    }
  }

  function dispatch(command: string): DispatchResult {
    const trimmed = command.trim();
    const [verb = '', ...args] = trimmed.split(/\s+/);
    const action = verb.toUpperCase();
    const [argument] = args;
    const id = args.length === 1 ? argument?.toLowerCase() : undefined;
    const noArgs = args.length === 0;
    const { phase } = route;
    if (phase === 'offline') {
      if (action !== 'CONNECT' || !noArgs) return system(screen().hint);
      route = { phase: 'login' };
      return system(...board.banner);
    }
    if (noArgs && action === 'HELP') {
      const { hint, actions } = screen();
      const commands = actions.filter((entry) => !entry.disabled).map((entry) => entry.command);
      return system(hint, fill(text.listing, { commands: commands.join(', ') }));
    }
    if (noArgs && action === 'DISCONNECT') {
      route = { phase: 'offline' };
      const result = system(text.disconnected);
      return phase === 'login' ? result : withHistory(result, { kind: 'disconnect' });
    }
    if (phase === 'login') {
      const { profile } = snapshot();
      if (action === 'DESIGNATION' && noArgs) {
        return profile.designation
          ? signIn(profile.designation)
          : system(text.noDesignation, screen().hint);
      }
      if (action === 'LOGIN') {
        const handle = normalizeHandle(trimmed.slice(verb.length));
        return handle
          ? signIn(handle, handle === profile.handle ? undefined : handle)
          : system(text.enterHandle, screen().hint);
      }
      return system(text.invalid, screen().hint);
    }

    if (noArgs) {
      if (action === 'MENU' && phase !== 'menu') return menu();
      if (action === 'BACK' && phase !== 'menu') return back();
      const secret = secrets.find(({ command }) => command.toUpperCase() === action);
      if (secret) {
        const known = snapshot().bbs.discoveries.includes(secret.id);
        const result: DispatchResult = {
          output: [
            {
              tone: 'private',
              lines: known ? [...secret.output, text.discoveryKnown] : secret.output,
            },
          ],
        };
        return known
          ? result
          : withHistory(result, { kind: 'secret', id: secret.id }, { discovery: secret.id });
      }
      if (action === 'DOORS' && doors && (phase === 'menu' || phase === 'directory')) {
        const entries = doors
          .list()
          .map(({ id, name, description }) =>
            fill(text.doorListing, { id, title: name, description }),
          );
        return withHistory(
          enter(
            { phase: 'doors', parent: phase },
            {
              tone: 'door',
              lines: [
                fill(text.section, { title: board.title, section: text.doorDirectory }),
                ...entries,
              ],
            },
          ),
          { kind: 'doors' },
        );
      }
      if (phase === 'menu') {
        const next = fromMenu(action);
        if (next) return next;
      }
      if (route.phase === 'profile' && action === 'TALK' && canTalk(route.profile)) {
        const line = say?.(route.profile.characterId);
        return {
          output: [
            { tone: 'private', lines: line?.text ?? [text.noDialogue], origin: 'fictional' },
          ],
        };
      }
      if (phase === 'directory' && action === 'NETWORK') {
        const nodes = mapNodes(offer.sectors, facts());
        const entries: BbsOutput[] = nodes.map(({ sector, enterable }) => ({
          tone: enterable ? 'system' : 'restricted',
          lines: [fill(enterable ? text.available : text.restricted, { title: sector.name })],
        }));
        return withHistory(
          enter({ phase: 'network' }, { tone: 'system', lines: [labels.NETWORK] }, ...entries),
          { kind: 'network' },
        );
      }
    }

    if (phase === 'messages' && action === 'READ') {
      const message = id && /^[0-9]+$/.test(id) ? visibleMessages()[Number(id) - 1] : undefined;
      if (!message) return system(text.chooseMessage, screen().hint);
      return withHistory(
        enter({ phase: 'message' }, messageOutput(message)),
        { kind: 'read', id: message.key },
        { readKeys: [message.key] },
      );
    }
    if (phase === 'doors' && action === 'OPEN') {
      return id ? { output: [], opensDoor: id } : system(text.chooseDoor, screen().hint);
    }
    if (phase === 'boards' && action === 'BOARD') {
      const next = boards.find((entry) => entry.id === id);
      if (next) {
        if (
          next.access &&
          !hasAccessLevel(accessLevels, deriveAccessLevel(accessLevels, facts()), next.access.level)
        ) {
          return { output: [{ tone: 'restricted', lines: [next.access.deniedText] }] };
        }
        return withHistory(showBoard(next), { kind: 'board', id: next.id });
      }
    }
    if (route.phase === 'board' && action === 'THREAD') {
      const thread = visibleThreads(route.board.id).find((entry) => entry.id === id);
      if (thread) {
        const posts = visiblePosts(thread);
        const choice = selectedReply(thread);
        const response = choice && messages.get(`message:${choice.messageId}`);
        return withHistory(
          enter(
            { phase: 'thread', thread, board: route.board },
            { tone: 'system', lines: [thread.title] },
            ...posts.map(messageOutput),
            ...(response && choice
              ? [
                  messageOutput(response),
                  { tone: 'system' as const, lines: [fill(text.chosen, { choice: choice.label })] },
                ]
              : []),
          ),
          { kind: 'thread', id: thread.id },
          { readKeys: [...posts.map((post) => post.key), ...(response ? [response.key] : [])] },
        );
      }
    }
    if (route.phase === 'thread' && action === 'REPLY') {
      const { thread } = route;
      const choice = thread.replies.find((entry) => entry.id === id);
      const response = choice && messages.get(`message:${choice.messageId}`);
      if (choice && response && !selectedReply(thread) && visiblePosts(thread).length) {
        return withHistory(
          {
            output: [
              messageOutput(response),
              ...system(fill(text.chosen, { choice: choice.label })).output,
            ],
          },
          { kind: 'reply', id: thread.id, choice: choice.id },
          { reply: { thread: thread.id, choice: choice.id }, readKeys: [response.key] },
        );
      }
    }
    if (phase === 'people' && action === 'PROFILE') {
      const profile = profiles.find((entry) => entry.id === id);
      if (profile) {
        const character = findCharacter(profile.characterId)!;
        return withHistory(
          enter(
            { phase: 'profile', profile },
            {
              tone: 'history',
              origin: 'fictional',
              lines: [
                fill(text.profile, { handle: profile.handle, name: character.name }),
                ...profile.bio,
              ],
            },
          ),
          { kind: 'profile', id: profile.id },
        );
      }
    }
    return system(text.invalid, screen().hint);
  }

  return { screen, dispatch };
}
