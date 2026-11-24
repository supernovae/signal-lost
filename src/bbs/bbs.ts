import { evaluate } from '../content/conditions.ts';
import type { Archive, BbsBoard, Content } from '../content/schema.ts';
import type { DoorListing } from '../doors/registry.ts';
import { normalizeHandle } from '../progress/save.ts';

type MessageFields = Pick<Archive, 'title' | 'from' | 'date' | 'body'>;
type BoardMessage = MessageFields & { key: string };

interface BbsOffer {
  board: BbsBoard;
  messages: BoardMessage[];
}

export function getBbsOffer(content: Content, facts: ReadonlySet<string>): BbsOffer | undefined {
  const board = content.bbs.find(
    (entry) => entry.kind === 'board' && evaluate(entry.requires, facts),
  );
  if (!board || board.kind !== 'board') return;

  const messages: BoardMessage[] = [];
  const addMessage = (key: string, { title, from, date, body }: MessageFields) => {
    messages.push({ key, title, from, date, body });
  };
  for (const id of board.archiveIds) {
    const archive = content.archives.find((entry) => entry.id === id);
    if (archive && evaluate(archive.requires, facts)) addMessage(`archive:${id}`, archive);
  }
  for (const entry of content.bbs) {
    if (entry.kind === 'message' && entry.board === board.id)
      addMessage(`message:${entry.id}`, entry);
  }
  return { board, messages };
}

type Phase = 'offline' | 'login' | 'menu' | 'messages' | 'message' | 'sysop' | 'doors';
export type BbsTone = 'system' | 'history' | 'sysop';
type Output = { tone: BbsTone; lines: readonly string[] };
export type BbsEffect = { handle: string } | { readKey: string };

interface Action {
  command: string;
  label: string;
}

interface Screen {
  phase: Phase;
  hint: string;
  actions: Action[];
}

interface DispatchResult {
  output: Output;
  effect?: BbsEffect;
  opensDoor?: string;
}

interface BbsDoors {
  list(): readonly DoorListing[];
  facts(): ReadonlySet<string>;
}

const help = { command: 'HELP', label: 'HELP' };
const disconnect = { command: 'DISCONNECT', label: 'DISCONNECT' };
const menu = { command: 'MENU', label: 'MAIN MENU' };

export function createBbs(
  { board, messages }: BbsOffer,
  identity: { designation: string | null; handle: string | null; readMessages: readonly string[] },
  doors?: BbsDoors,
) {
  const read = new Set(identity.readMessages);
  let customHandle = identity.handle;
  let phase: Phase = 'offline';

  function screen(): Screen {
    switch (phase) {
      case 'offline':
        return {
          phase,
          hint: board.notice,
          actions: [{ command: 'CONNECT', label: 'CONNECT' }],
        };
      case 'login':
        return {
          phase,
          hint: identity.designation
            ? 'TYPE DESIGNATION OR LOGIN <HANDLE>, OR SELECT A SIGN-IN OPTION.'
            : 'TYPE LOGIN <HANDLE> OR SELECT CUSTOM HANDLE.',
          actions: [
            ...(identity.designation
              ? [{ command: 'DESIGNATION', label: `USE DESIGNATION (${identity.designation})` }]
              : []),
            { command: 'LOGIN', label: 'CUSTOM HANDLE' },
            help,
            disconnect,
          ],
        };
      case 'menu':
        return {
          phase,
          hint: `TYPE MESSAGES, SYSOP, ${doors ? 'DOORS, ' : ''}HELP OR DISCONNECT, OR SELECT AN OPTION.`,
          actions: [
            { command: 'MESSAGES', label: 'MESSAGES' },
            { command: 'SYSOP', label: 'SYSOP' },
            ...(doors ? [{ command: 'DOORS', label: 'DOORS' }] : []),
            help,
            disconnect,
          ],
        };
      case 'doors': {
        const available = doors?.list() ?? [];
        return {
          phase,
          hint: available.length
            ? 'TYPE OPEN <ID> OR SELECT A DOOR. TYPE MENU TO RETURN.'
            : 'NO DOORS AVAILABLE. TYPE MENU TO RETURN.',
          actions: [
            ...available.map(({ id, name }) => ({ command: `OPEN ${id}`, label: name })),
            menu,
            help,
            disconnect,
          ],
        };
      }
      case 'messages':
        return {
          phase,
          hint: messages.length
            ? 'TYPE READ <NUMBER> OR SELECT A MESSAGE. TYPE MENU TO RETURN.'
            : 'NO MESSAGES AVAILABLE. TYPE MENU TO RETURN.',
          actions: [
            ...messages.map((message, index) => ({
              command: `READ ${index + 1}`,
              label: `${message.title} [${read.has(message.key) ? 'READ' : 'UNREAD'}]`,
            })),
            menu,
            help,
            disconnect,
          ],
        };
      case 'message':
      case 'sysop':
        return {
          phase,
          hint: 'TYPE MENU TO RETURN, HELP FOR OPTIONS OR DISCONNECT TO LEAVE.',
          actions: [menu, help, disconnect],
        };
    }
  }

  function system(...lines: string[]): DispatchResult {
    return { output: { tone: 'system', lines } };
  }

  function enter(next: Phase, ...lines: string[]): DispatchResult {
    phase = next;
    if (next === 'menu') {
      const facts = doors?.facts() ?? new Set<string>();
      lines.push(
        `${board.title} MAIN MENU`,
        ...board.status.filter(({ when }) => evaluate(when, facts)).map(({ text }) => text),
      );
    }
    return system(...lines, screen().hint);
  }

  function signIn(handle: string): DispatchResult {
    return enter('menu', `SIGNED IN AS ${handle}`);
  }

  function dispatch(command: string): DispatchResult {
    const [verb = '', ...args] = command.trim().split(/\s+/);
    const action = verb.toUpperCase();
    const hasArgument = args.length > 0;
    if (phase === 'offline') {
      if (action !== 'CONNECT' || hasArgument) return system(screen().hint);
      phase = 'login';
      return system(...board.banner);
    }
    if (!hasArgument) {
      if (action === 'HELP') return system(screen().hint);
      if (action === 'DISCONNECT') {
        phase = 'offline';
        return system('DISCONNECTED');
      }
    }
    if (phase === 'login') {
      if (action === 'DESIGNATION' && !hasArgument) {
        if (identity.designation) return signIn(identity.designation);
        return system('NO OBSERVER DESIGNATION AVAILABLE.', screen().hint);
      }
      if (action === 'LOGIN') {
        const handle = normalizeHandle(command.trimStart().slice(verb.length));
        if (!handle) return system('ENTER A FICTIONAL HANDLE.', screen().hint);
        const result = signIn(handle);
        if (customHandle === handle) return result;
        customHandle = handle;
        return { ...result, effect: { handle } };
      }
    }
    if (phase === 'menu' && !hasArgument) {
      if (action === 'MESSAGES') return enter('messages', `${board.title} MESSAGES`);
      if (action === 'DOORS' && doors) {
        return enter(
          'doors',
          `${board.title} DOOR DIRECTORY`,
          ...doors
            .list()
            .map(({ id, name, description }) => `OPEN ${id} | ${name} | ${description}`),
        );
      }
      if (action === 'SYSOP') {
        phase = 'sysop';
        return { output: { tone: 'sysop', lines: board.sysopGreeting } };
      }
    }
    if (phase === 'messages' && action === 'READ') {
      const [number = ''] = args;
      const message =
        args.length === 1 && /^[0-9]+$/.test(number) ? messages[Number(number) - 1] : undefined;
      if (!message) return system('SELECT A MESSAGE FROM THE LIST.', screen().hint);
      phase = 'message';
      const result: DispatchResult = {
        output: {
          tone: 'history',
          lines: [message.title, `FROM: ${message.from}`, `DATE: ${message.date}`, ...message.body],
        },
      };
      if (read.has(message.key)) return result;
      read.add(message.key);
      return { ...result, effect: { readKey: message.key } };
    }
    if (phase === 'doors' && action === 'OPEN') {
      const [id] = args;
      if (args.length !== 1 || !id) return system('SELECT A DOOR FROM THE LIST.', screen().hint);
      return { ...system(screen().hint), opensDoor: id.toLowerCase() };
    }
    if (phase !== 'login' && phase !== 'menu' && !hasArgument && action === 'MENU') {
      return enter('menu');
    }
    return system('COMMAND UNAVAILABLE HERE.', screen().hint);
  }

  return { screen, dispatch };
}
