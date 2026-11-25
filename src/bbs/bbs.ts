import { evaluate } from '../content/conditions.ts';
import type { BbsThread, BbsTone, DialogueLine, bbsOrderVerbs } from '../content/schema.ts';
import type { DoorListing } from '../doors/registry.ts';
import { deriveAccessLevel, hasAccessLevel } from '../progress/access.ts';
import { normalizeHandle } from '../progress/save.ts';
import { mapNodes } from '../world/map.ts';
import { bbsCopy, fill, messageCredit } from './copy.ts';
import type { BbsOffer, Message, MessageBoard, Profile } from './offer.ts';
import type { BbsEffect, BbsHistoryEntry, BbsSnapshot } from './progress.ts';

export { getBbsOffer } from './offer.ts';

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
  | { phase: 'board'; board: MessageBoard; draft: string[] }
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
type OrderCheck = NonNullable<MessageBoard['orderCheck']>;
type OrderVerb = (typeof bbsOrderVerbs)[number];

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
const orderButton = (command: string, disabled: boolean): BbsAction => ({
  command,
  label: command,
  disabled,
});

function missingOrderEvidence(check: OrderCheck, facts: ReadonlySet<string>): string | undefined {
  return check.prerequisites.find(({ fact }) => !facts.has(fact))?.missingEvidence;
}

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

  const visibleBoards = (phase: 'boards' | 'directory') => {
    const current = facts();
    return boards.filter(
      (entry) =>
        Boolean(entry.directory) === (phase === 'directory') && evaluate(entry.requires, current),
    );
  };
  const boardLinks = (phase: 'boards' | 'directory') =>
    visibleBoards(phase).map(({ id, title }) => link('BOARD', id, title));
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
        return view(boardLinks('boards'));
      case 'board': {
        const { board, draft } = route;
        const threads = visibleThreads(board.id).map(({ id, title }) => link('THREAD', id, title));
        const check = board.orderCheck;
        if (!check) return view(threads, board.check?.prompt);
        const current = facts();
        const missing = missingOrderEvidence(check, current);
        if (missing || !evaluate(board.requires, current)) return view(threads, missing);
        const operations = check.operations.map(({ token }) => token).sort();
        return view(
          [
            ...threads,
            ...operations.map((token) => ({
              ...orderButton(`ORDER ${token}`, draft.includes(token)),
              selected: draft.includes(token),
            })),
            orderButton('CLEAR', !draft.length),
            orderButton('APPLY', draft.length !== operations.length),
          ],
          check.prompt,
        );
      }
      case 'thread': {
        if (!visiblePosts(route.thread).length) return view([]);
        const selected = selectedReply(route.thread);
        return view(
          route.thread.replies.map(({ id, label }) => ({
            ...link('REPLY', id, label),
            selected: selected?.id === id,
            disabled: Boolean(selected),
          })),
          route.board.check?.prompt,
        );
      }
      case 'people':
        return view(profiles.map(({ id, handle }) => link('PROFILE', id, handle)));
      case 'profile':
        return view(canTalk(route.profile) ? [actionButton('TALK')] : []);
      case 'directory':
        return view([
          ...(doors ? [actionButton('DOORS')] : []),
          actionButton('NETWORK'),
          ...boardLinks('directory'),
        ]);
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
      { phase: 'board', board: next, draft: [] },
      {
        tone: 'system',
        lines: [
          next.title,
          ...next.description,
          ...(available || next.orderCheck ? [] : [text.noThreads]),
        ],
      },
    );
  }

  function back(): DispatchResult {
    switch (route.phase) {
      case 'board':
        return route.board.directory
          ? section({ phase: 'directory' }, labels.DIRECTORY)
          : section({ phase: 'boards' }, labels.BOARDS);
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

  function checkAnswer(
    check: NonNullable<MessageBoard['check']>,
    answer: string | undefined,
    current: ReadonlySet<string>,
  ) {
    if (!check.evidenceMessageIds.every((id) => current.has(`bbs-read:${id}`))) {
      return system(check.missingEvidence);
    }
    if (answer !== check.answer.toLowerCase()) return system(check.incorrect);
    return readCheckResponse(check.responseMessageId);
  }

  function readCheckResponse(messageId: string): DispatchResult {
    const response = offer.bulletins.get(messageId);
    if (!response) return system(text.invalid, screen().hint);
    const result = { output: [messageOutput(response)] };
    if (snapshot().bbsReadMessages.includes(response.key)) return result;
    return withHistory(result, { kind: 'read', id: response.key }, { readKeys: [response.key] });
  }

  function checkOrder(
    check: OrderCheck,
    { board, draft }: Extract<Route, { phase: 'board' }>,
    action: OrderVerb,
    args: string[],
  ): DispatchResult {
    const current = facts();
    const missing = missingOrderEvidence(check, current);
    if (missing) return system(missing);
    if (!evaluate(board.requires, current)) return system(text.invalid, screen().hint);

    if (action === 'APPLY') {
      const order = args.length
        ? args
            .join(' ')
            .split('/')
            .map((token) => token.trim().toUpperCase())
        : draft;
      const operations = new Map(check.operations.map((operation) => [operation.token, operation]));
      if (
        order.length !== operations.size ||
        new Set(order).size !== order.length ||
        order.some((token) => !operations.has(token))
      ) {
        return system(check.invalidOrder);
      }
      const misplaced = order.find((token, index) => token !== check.operations[index]?.token);
      if (misplaced) return system(operations.get(misplaced)!.outOfOrder);
      draft.length = 0;
      return readCheckResponse(check.responseMessageId);
    }

    if (action === 'CLEAR' && !args.length) {
      draft.length = 0;
    } else if (action === 'ORDER' && args.length === 1) {
      const token = args[0]!.toUpperCase();
      if (
        !check.operations.some((operation) => operation.token === token) ||
        draft.includes(token)
      ) {
        return system(text.invalid, screen().hint);
      }
      draft.push(token);
    } else {
      return system(text.invalid, screen().hint);
    }
    return system(`STAGED ORDER: ${draft.join(' / ') || 'EMPTY'}`);
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
    if ((phase === 'boards' || phase === 'directory') && action === 'BOARD') {
      const next = visibleBoards(phase).find((entry) => entry.id === id);
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
    if (
      route.phase === 'board' &&
      route.board.orderCheck &&
      (action === 'ORDER' || action === 'CLEAR' || action === 'APPLY')
    ) {
      return checkOrder(route.board.orderCheck, route, action, args);
    }
    if (route.phase === 'board' || route.phase === 'thread') {
      const { check } = route.board;
      if (check?.verb === action) {
        const current = facts();
        if (evaluate(route.board.requires, current)) return checkAnswer(check, id, current);
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
