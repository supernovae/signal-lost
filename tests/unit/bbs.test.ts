import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildTools } from '../../src/app/tools.ts';
import { createAudio } from '../../src/audio/audio.ts';
import { createBbs, getBbsOffer, type DispatchResult } from '../../src/bbs/bbs.ts';
import { applyBbsEffect, createBbsProgress } from '../../src/bbs/progress.ts';
import { evaluate } from '../../src/content/conditions.ts';
import { projectEntryContent } from '../../src/content/browser-split.ts';
import { readContentDir } from '../../src/content/node.ts';
import type { Content } from '../../src/content/schema.ts';
import { loadContent } from '../../src/content/validate.ts';
import { createBbsDoorSession } from '../../src/bbs/door-session.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { createDialogueSources } from '../../src/narrative/dialogue.ts';
import { deriveAccessLevel } from '../../src/progress/access.ts';
import { settleEvents } from '../../src/progress/events.ts';
import { factsOf, openSaveSession } from '../../src/progress/save.ts';
import { createGame } from '../../src/puzzle/game.ts';
import { mapNodes } from '../../src/world/map.ts';
import discoveryFixture from '../fixtures/bbs-discovery.json';
import completedV1 from '../fixtures/episode-000-complete-v1.json';

const contentDir = resolve('content');
const completed = new Set(['completed:episode.000']);
const bundledFiles = readContentDir(contentDir);
const { content } = loadContent(bundledFiles);
const banner = [
  'OBSERVER NETWORK RELAY 07',
  'SYSTEM STATUS: DEGRADED',
  'ACTIVE CONNECTIONS: UNKNOWN',
  'INCOMING CONNECTION ACCEPTED',
  'WELCOME TO THE ECHO NETWORK',
];
const sysopGreeting = [
  'Observer. I am the local preservation routine.',
  'Keel left the line open. I kept what the board could carry.',
];

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    get value() {
      return value;
    },
    getItem: () => value,
    setItem: vi.fn((_key: string, text: string) => {
      value = text;
    }),
    removeItem: () => {
      value = null;
    },
  };
}

function sessionData(storage = memoryStorage()) {
  const session = openSaveSession(storage, () => 42);
  if (session.status === 'new') {
    session.data.episodes.push('episode.000');
    session.data.profile.designation = 'OBS-02FF';
  }
  return { ...session, storage };
}

const lines = (result: DispatchResult) => result.output.flatMap((block) => block.lines);
const offer = (records: Content = content) => getBbsOffer(records, completed)!;

function boardSession(
  session = sessionData(),
  records = content,
  liveFacts?: () => ReadonlySet<string>,
) {
  const { data, persist } = session;
  const registry = createDoorRegistry(records.doors);
  const progress = createBbsProgress(
    data,
    (candidate) => settleEvents(records.events, candidate),
    persist,
  );
  const game = createGame({ content: records, data, persist });
  const voices = createDialogueSources(records.characters);
  const bbs = createBbs(
    getBbsOffer(records, factsOf(data))!,
    () => data,
    {
      list: () => registry.list(factsOf(data)),
      facts: liveFacts ?? (() => factsOf(data)),
    },
    (characterId) => {
      const source = voices.get(characterId);
      return source && game.say(source, 'bbs');
    },
  );
  function run(command: string) {
    const wasOffline = bbs.screen().phase === 'offline';
    const result = bbs.dispatch(command);
    if (wasOffline && bbs.screen().phase === 'login') progress.connect();
    if (result.effect) progress.apply(result.effect);
    return result;
  }
  return {
    ...session,
    bbs,
    run,
    commands: () => bbs.screen().actions.map(({ command }) => command),
  };
}

function runAll(run: (command: string) => DispatchResult, ...commands: string[]) {
  for (const command of commands) run(command);
}

describe('the DEEP FIELD session', () => {
  it('gates the endpoint and keeps the original banner, numbered Messages, SYSOP and menu status', () => {
    expect(getBbsOffer(content, new Set())).toBeUndefined();
    const { run, bbs, commands, data } = boardSession();
    expect(bbs.screen().phase).toBe('offline');
    expect(run('connect')).toEqual({ output: [{ tone: 'system', lines: banner }] });
    expect(commands()).toEqual(['DESIGNATION', 'LOGIN', 'HELP', 'DISCONNECT']);
    expect(lines(run('designation'))).toEqual(
      expect.arrayContaining(['SIGNED IN AS OBS-02FF', 'ACCESS LEVEL: VISITOR']),
    );
    expect(commands()).toEqual([
      'BOARDS',
      'MESSAGES',
      'SYSOP',
      'PEOPLE',
      'DIRECTORY',
      'DOORS',
      'HISTORY',
      'SETTINGS',
      'HELP',
      'DISCONNECT',
    ]);
    expect(lines(run('MESSAGES'))).toContain(bbs.screen().hint);
    expect(bbs.screen().actions[0]).toEqual({ command: 'READ 1', label: 'LAST ONE OUT [UNREAD]' });
    const farewell = content.archives.find((archive) => archive.id === 'lore.last-sysop')!;
    expect(run('READ 1').output[0]).toMatchObject({
      tone: 'history',
      origin: 'fictional',
      lines: ['LAST ONE OUT', 'FROM: TKEEL', 'DATE: 2001-03-01', ...farewell.body],
    });
    expect(bbs.screen().phase).toBe('message');
    run('BACK');
    expect(bbs.screen().actions[0]?.label).toBe('LAST ONE OUT [READ]');
    run('MENU');
    expect(run('SYSOP').output).toEqual([
      { tone: 'sysop', origin: 'fictional', lines: sysopGreeting },
    ]);
    data.flags.push('relay-trivia-complete');
    expect(lines(run('MENU'))).toEqual(
      expect.arrayContaining(['ACCESS LEVEL: RELAY', 'RELAY DRILL: COMPLETE']),
    );
    expect(lines(run('DISCONNECT'))).toEqual(['DISCONNECTED']);
    expect(bbs.screen().phase).toBe('offline');
  });

  it.each([false, true])(
    'opens FORGE from Directory with prior panel discovery %s',
    (discovered) => {
      const session = sessionData();
      if (discovered) session.data.flags.push('service-panel-open', 'forge-opened');
      const { run, bbs, commands, data, storage } = boardSession(session);
      const forge = content.artifacts.find(({ id }) => id === 'forge')!;
      const command = 'OPEN forge';

      expect(commands()).not.toContain(command);
      expect(run(command).opensArtifact).toBeUndefined();
      run('CONNECT');
      expect(commands()).not.toContain(command);
      expect(run(command).opensArtifact).toBeUndefined();
      expect(lines(run('DESIGNATION'))).toContain('DIRECTORY / FORGE takes proposals.');
      expect(commands()).not.toContain(command);
      expect(run(command).opensArtifact).toBeUndefined();

      run('DIRECTORY');
      expect(bbs.screen().actions).toContainEqual({ command, label: forge.name });
      expect(lines(run('HELP')).join(' ')).toContain(command);
      expect(run('OPEN unknown').opensArtifact).toBeUndefined();
      expect(run('OPEN forge extra').opensArtifact).toBeUndefined();
      expect(bbs.screen().phase).toBe('directory');
      const before = structuredClone(data);
      const saved = storage.value;
      const result = run('open FORGE');
      expect(result.opensArtifact).toEqual(forge);
      expect(lines(result)).toContain('DEEP FIELD FORGE');
      expect(result.effect).toBeUndefined();
      expect(data).toStrictEqual(before);
      expect(storage.value).toBe(saved);
      expect(evaluate(forge.requires, factsOf(data))).toBe(discovered);
      expect(bbs.screen().phase).toBe('artifact');
      expect(commands()).toEqual(['BACK', 'MENU', 'HELP', 'DISCONNECT']);
      expect(run(command).opensArtifact).toBeUndefined();
      run('BACK');
      expect(bbs.screen().phase).toBe('directory');
      runAll(run, command, 'MENU');
      expect(bbs.screen().phase).toBe('menu');
      expect(run(command).opensArtifact).toBeUndefined();
      runAll(run, 'DIRECTORY', 'DOORS');
      expect(run(command).opensArtifact).toBeUndefined();
      runAll(run, 'BACK', command, 'DISCONNECT');
      expect(bbs.screen().phase).toBe('offline');
    },
  );

  it('uses the static greeting or an explicit unavailable message without a dialogue callback', () => {
    const { data } = sessionData();
    const current = offer();
    for (const [board, expected] of [
      [current.board, ['NO RESPONSE AVAILABLE.']],
      [{ ...current.board, sysopCharacterId: undefined, sysopGreeting }, sysopGreeting],
    ] as const) {
      const bbs = createBbs({ ...current, board }, () => data);
      runAll(bbs.dispatch, 'CONNECT', 'DESIGNATION');
      expect(bbs.dispatch('SYSOP').output).toEqual([
        { tone: 'sysop', origin: 'fictional', lines: expected },
      ]);
    }
  });

  it('normalizes a custom handle and rejects invalid input without leaving the current screen', () => {
    const { run, bbs, data, commands } = boardSession();
    data.profile.designation = null;
    expect(run('MESSAGES').effect).toBeUndefined();
    run('CONNECT');
    expect(commands()).not.toContain('DESIGNATION');
    expect(lines(run('DESIGNATION'))).toContain('NO OBSERVER DESIGNATION AVAILABLE.');
    expect(lines(run('LOGIN  '))).toContain('ENTER A FICTIONAL HANDLE.');
    expect(run('DISCONNECT').effect).toBeUndefined();
    run('CONNECT');
    expect(run('  lOgIn   Relay  Finch   ').effect).toEqual({
      handle: 'Relay  Finch',
      history: { kind: 'sign-in' },
    });
    expect(run('THREAD relay-thread').effect).toBeUndefined();
    expect(run('DOORS extra').effect).toBeUndefined();
    expect(bbs.screen().phase).toBe('menu');
    run('MESSAGES');
    for (const invalid of ['READ', 'READ two', 'READ 0', 'READ 2', 'READ 1.5', 'READ 1 2']) {
      const result = run(invalid);
      expect(lines(result)).toContain('SELECT A MESSAGE FROM THE LIST.');
      expect(result.effect).toBeUndefined();
      expect(bbs.screen().phase).toBe('messages');
    }
  });

  it('adds a list entry and read command from a standalone JSON message', () => {
    const root = mkdtempSync(join(tmpdir(), 'signal-lost-bbs-'));
    try {
      cpSync(contentDir, root, { recursive: true });
      const body = 'I left a spare cable beside the relay.';
      writeFileSync(
        join(root, 'bbs', 'spare-cable.json'),
        JSON.stringify({
          kind: 'message',
          id: 'spare-cable',
          board: 'deep-field',
          title: 'SPARE CABLE',
          from: 'FINCH',
          date: '2001-03-02',
          body: [body],
        }),
      );
      const after = loadContent(readContentDir(root));
      expect(after.errors).toEqual([]);
      expect(after.manifest.entries).toContainEqual({
        kind: 'bbs',
        id: 'spare-cable',
        file: 'content/bbs/spare-cable.json',
      });
      const { run, bbs } = boardSession(sessionData(), after.content);
      runAll(run, 'CONNECT', 'DESIGNATION', 'MESSAGES');
      expect(bbs.screen().actions.slice(0, 2)).toEqual([
        { command: 'READ 1', label: 'LAST ONE OUT [UNREAD]' },
        { command: 'READ 2', label: 'SPARE CABLE [UNREAD]' },
      ]);
      expect(run('READ 2').output[0]).toMatchObject({
        tone: 'history',
        origin: 'fictional',
        lines: ['SPARE CABLE', 'FROM: FINCH', 'DATE: 2001-03-02', body],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const openThread = [
  'CONNECT',
  'DESIGNATION',
  'BOARDS',
  'BOARD general',
  'THREAD relay-thread',
] as const;

it('routes SYSOP and profile TALK to their own scripted lines before and after the relay read', () => {
  const { run, data, commands } = boardSession();
  const talk = () => {
    runAll(run, 'MENU', 'PEOPLE', 'PROFILE echo-profile');
    expect(commands()).toContain('TALK');
    return run('TALK').output;
  };
  runAll(run, 'CONNECT', 'DESIGNATION');
  expect(run('SYSOP').output).toEqual([
    { tone: 'sysop', origin: 'fictional', lines: sysopGreeting },
  ]);
  expect(talk()).toEqual([
    {
      tone: 'private',
      origin: 'fictional',
      lines: ['ECHO: The relay desk note is available. I have no receipt for your copy yet.'],
    },
  ]);
  runAll(run, 'MENU', ...openThread.slice(2), 'MENU');
  expect(data.flags).toContain('relay-note-read');
  run('BOARDS');
  expect(lines(run('MENU'))).toContain('ACCESS LEVEL: VISITOR');
  expect(run('SYSOP').output).toEqual([
    {
      tone: 'sysop',
      origin: 'fictional',
      lines: ['RECEIPT FILED AT RELAY 07. ORIGINAL REMAINS READ-ONLY.'],
    },
  ]);
  expect(talk()).toEqual([
    {
      tone: 'private',
      origin: 'fictional',
      lines: ['ECHO: The desk logged your read. A receipt tells me where the copy landed.'],
    },
  ]);
  expect(data.seenLines).toEqual([
    'sysop.bbs.greeting',
    'echo.bbs.greeting',
    'sysop.bbs.relay-receipt',
    'echo.bbs.relay-receipt',
  ]);
});

it('posts one new bulletin in the same save as the qualifying BBS read', () => {
  const { run, bbs, storage, data } = boardSession();
  runAll(run, 'CONNECT', 'DESIGNATION', 'MESSAGES', 'READ 1', 'MENU', 'BOARDS', 'BOARD general');
  expect(data.events.fired).toEqual([]);
  runAll(run, 'MENU', 'MESSAGES');
  expect(bbs.screen().actions.filter(({ command }) => command.startsWith('READ '))).toEqual([
    { command: 'READ 1', label: 'LAST ONE OUT [READ]' },
  ]);
  expect(run('READ 2').effect).toBeUndefined();
  runAll(run, 'MENU', 'BOARDS', 'BOARD general');
  storage.setItem.mockClear();
  const opened = run('THREAD relay-thread');
  expect(opened.effect?.readKeys).toContain('message:relay-note');
  expect(storage.setItem).toHaveBeenCalledOnce();
  expect(JSON.parse(storage.value!)).toMatchObject({
    bbs: { history: expect.arrayContaining([{ kind: 'thread', id: 'relay-thread' }]) },
    bbsReadMessages: ['archive:lore.last-sysop', 'message:relay-note'],
    flags: ['relay-note-read'],
    events: { fired: ['relay-read', 'relay-bulletin'], bulletins: ['relay-bulletin'] },
  });

  data.events.bulletins.unshift('removed-bulletin');
  runAll(run, 'MENU', 'MESSAGES');
  expect(bbs.screen().actions.slice(0, 2)).toEqual([
    { command: 'READ 1', label: 'LAST ONE OUT [READ]' },
    { command: 'READ 2', label: 'Relay desk receipt [NEW]' },
  ]);
  expect(lines(run('READ 2'))).toContain('Local receipt filed for the relay desk note.');
  run('BACK');
  expect(bbs.screen().actions[1]).toEqual({
    command: 'READ 2',
    label: 'Relay desk receipt [READ]',
  });
  run('MENU');
  expect(lines(run('HISTORY'))).toContain('Read message: Relay desk receipt');
});

it('keeps a triggered bulletin in this tab when the qualifying read cannot be saved', () => {
  const { run, bbs, storage } = boardSession();
  runAll(run, ...openThread.slice(0, -1));
  const previous = storage.value;
  storage.setItem.mockImplementationOnce(() => {
    throw new Error('storage refused write');
  });
  runAll(run, 'THREAD relay-thread', 'MENU', 'MESSAGES');
  expect(bbs.screen().actions[1]?.label).toBe('Relay desk receipt [NEW]');
  expect(storage.value).toBe(previous);
  expect(sessionData(storage).data.events.fired).toEqual([]);
});

it('lists both boards and sorts visible threads by authored order and ID while preserving post order', () => {
  const original = bundledFiles['content/bbs/relay-thread.json'] as Record<string, unknown>;
  const { content: records, errors } = loadContent({
    ...bundledFiles,
    ...discoveryFixture,
    'content/bbs/aaa-file.json': { ...original, id: 'z-thread', order: 1, replies: [] },
    'content/bbs/zzz-file.json': {
      ...original,
      id: 'a-thread',
      order: 1,
      replies: [],
      messages: [
        { kind: 'archive', id: 'lore.last-sysop' },
        { kind: 'message', id: 'relay-note' },
      ],
    },
  });
  expect(errors).toEqual([]);
  const { run, bbs, commands, data, storage } = boardSession(sessionData(), records);
  runAll(run, 'CONNECT', 'DESIGNATION', 'BOARDS');
  expect(
    commands().filter((command) => /^(BOARD general|BOARD second-line)$/.test(command)),
  ).toEqual(['BOARD general', 'BOARD second-line']);
  expect(run('BOARD general extra').effect).toBeUndefined();
  expect(run('BOARD missing').effect).toBeUndefined();
  run('BOARD general');
  expect(commands().slice(0, 4)).toEqual([
    'THREAD relay-thread',
    'THREAD a-thread',
    'THREAD z-thread',
    'THREAD fixture-thread',
  ]);
  expect(run('THREAD second-line-thread').effect).toBeUndefined();
  const opened = run('THREAD a-thread');
  const messages = opened.output.filter(({ origin }) => origin);
  expect(messages.map(({ lines }) => lines.slice(0, 3))).toEqual([
    ['LAST ONE OUT', 'FROM: TKEEL', 'DATE: 2001-03-01'],
    ['A note at the relay desk', 'FROM: ECHO', 'DATE: UNDATED'],
  ]);
  expect(data.archives).toEqual([]);
  expect(data.bbsReadMessages).toEqual(['archive:lore.last-sysop', 'message:relay-note']);
  expect(commands().slice(0, 2)).toEqual(['BACK', 'MENU']);
  runAll(run, 'BACK', 'BACK');
  expect(lines(run('HELP')).join(' ')).toContain('BOARD second-line');
  const before = structuredClone(data);
  storage.setItem.mockClear();
  expect(run('BOARD second-line')).toEqual({
    output: [
      {
        tone: 'restricted',
        lines: ['SECOND LINE SWITCHBOARD: CARRIER HELD. RELAY CLEARANCE REQUIRED.'],
      },
    ],
  });
  expect(bbs.screen().phase).toBe('boards');
  expect(commands()).toContain('BOARD second-line');
  expect(commands()).not.toContain('THREAD second-line-thread');
  expect(run('THREAD second-line-thread').effect).toBeUndefined();
  expect(run('REPLY acknowledge').effect).toBeUndefined();
  expect(data).toEqual(before);
  expect(storage.setItem).not.toHaveBeenCalled();
  data.flags.push('service-panel-open');
  expect(run('BOARD second-line').effect).toEqual({
    history: { kind: 'board', id: 'second-line' },
  });
  expect(bbs.screen().phase).toBe('board');
  expect(commands()).toContain('THREAD second-line-thread');
  expect(run('THREAD second-line-thread').output[1]).toMatchObject({
    tone: 'recovered',
    origin: 'reviewed-community',
    credit: 'FILED BY: SIGNAL//LOST maintainers (supernovae)',
  });
  expect(data.archives).toEqual([]);
});

it.each([
  ['acknowledge', 'Receipt filed', 'Acknowledge the note', 'defer'],
  ['defer', 'Note left pending', 'Leave the note pending', 'acknowledge'],
])('persists the authored %s reply and its history together', (choice, response, label, other) => {
  const { run, storage, bbs } = boardSession();
  runAll(run, ...openThread);
  expect(
    bbs
      .screen()
      .actions.slice(0, 2)
      .map(({ command }) => command),
  ).toEqual(['REPLY acknowledge', 'REPLY defer']);
  for (const command of ['REPLY missing', 'REPLY', 'REPLY acknowledge extra']) {
    expect(run(command).effect).toBeUndefined();
  }
  storage.setItem.mockClear();
  const result = run(`REPLY ${choice}`);
  expect(result.output[0]).toMatchObject({ tone: 'private', origin: 'fictional' });
  expect(lines(result).filter((line) => line === response)).toHaveLength(1);
  expect(storage.setItem).toHaveBeenCalledOnce();
  expect(JSON.parse(storage.value!).bbs).toMatchObject({
    replies: { 'relay-thread': choice },
    history: expect.arrayContaining([{ kind: 'reply', id: 'relay-thread', choice }]),
  });
  expect(run(`REPLY ${choice}`).effect).toBeUndefined();
  expect(run(`REPLY ${other}`).effect).toBeUndefined();
  const restored = boardSession(sessionData(storage));
  runAll(restored.run, ...openThread.slice(0, -1));
  expect(lines(restored.run('THREAD relay-thread'))).toContain(response);
  expect(restored.bbs.screen().actions).toContainEqual({
    command: `REPLY ${choice}`,
    label,
    selected: true,
    disabled: true,
  });
  expect(restored.data.bbs.history.filter(({ kind }) => kind === 'reply')).toHaveLength(1);
});

it('offers current replies when a saved choice is gone and keeps the old history readable', () => {
  const session = sessionData();
  session.data.bbs.replies['relay-thread'] = 'old-choice';
  session.data.bbs.history.push({ kind: 'reply', id: 'relay-thread', choice: 'old-choice' });
  const { run, bbs } = boardSession(session);
  runAll(run, 'CONNECT', 'DESIGNATION');
  expect(lines(run('HISTORY'))).toContain('Replied in Relay desk notes: ENTRY NO LONGER AVAILABLE');
  runAll(run, 'MENU', ...openThread.slice(2));
  expect(bbs.screen().actions[0]).toMatchObject({ command: 'REPLY acknowledge', disabled: false });
  expect(run('REPLY acknowledge').effect?.reply?.choice).toBe('acknowledge');
});

it('opens fictional profiles and lists doors and network sectors without granting facts or entering them', () => {
  const session = sessionData();
  const records: Content = {
    ...content,
    sectors: [
      ...content.sectors,
      { ...content.sectors[0]!, id: 'hidden', name: 'HIDDEN', visibleWhen: 'flag:invisible' },
    ],
  };
  const { run, commands, data, bbs } = boardSession(session, records);
  const before = factsOf(data);
  runAll(run, 'CONNECT', 'DESIGNATION', 'PEOPLE');
  expect(commands()).toContain('PROFILE echo-profile');
  expect(run('PROFILE other').effect).toBeUndefined();
  expect(run('PROFILE echo-profile').output[0]).toMatchObject({
    tone: 'history',
    origin: 'fictional',
    lines: expect.arrayContaining([expect.stringContaining('scripted records')]),
  });
  run('BACK');
  expect(bbs.screen().phase).toBe('people');
  runAll(run, 'MENU', 'DIRECTORY');
  expect(commands().slice(0, 2)).toEqual(['DOORS', 'NETWORK']);
  expect(run('DOORS').output[0]).toMatchObject({ tone: 'door' });
  const listed = createDoorRegistry(content.doors).list(before);
  expect(commands().filter((command) => command.startsWith('OPEN '))).toEqual(
    listed.map(({ id }) => `OPEN ${id}`),
  );
  expect(run('OPEN relay-trivia extra').opensDoor).toBeUndefined();
  run('BACK');
  expect(bbs.screen().phase).toBe('directory');
  const network = run('NETWORK');
  expect(network.output).toContainEqual({ tone: 'system', lines: ['RELAY 07 | AVAILABLE'] });
  expect(network.output).toContainEqual({
    tone: 'restricted',
    lines: ['SILENT OBSERVATORY | RESTRICTED'],
  });
  expect(lines(network).join(' ')).not.toMatch(/HIDDEN|GRID|OBSERVERS ONLINE/);
  expect(factsOf(data)).toEqual(before);
  expect(data.doorState).toEqual({});
});

it('stores exactly the successful local actions, including successful door launch only', async () => {
  const { data, persist, storage } = sessionData();
  const host = createDoorHost(createDoorRegistry(content.doors), data, persist);
  const bbs = createBbsDoorSession(offer(), () => data, host);
  async function run(command: string) {
    const result = (await bbs.dispatch(command))!;
    if (result.effect) {
      applyBbsEffect(data, result.effect);
      expect(persist()).toBe(true);
    }
    return result;
  }
  expect(data.bbs.history).toEqual([]);
  await run('CONNECT');
  await run('HELP');
  await run('garbage-command');
  expect(data.bbs.history).toEqual([]);
  for (const command of [
    'LOGIN My Private Handle',
    'BOARDS',
    'BOARD general',
    'THREAD relay-thread',
    'REPLY defer',
    'MENU',
    'MESSAGES',
    'READ 1',
    'BACK',
    'READ 1',
    'MENU',
    'PEOPLE',
    'PROFILE echo-profile',
    'MENU',
    'DIRECTORY',
    'NETWORK',
    'BACK',
    'DOORS',
  ])
    await run(command);
  expect((await run('OPEN absent')).output[0]?.tone).toBe('restricted');
  expect((await run('OPEN relay-trivia')).output[0]?.tone).toBe('door');
  await run('EXIT');
  const observed = lines(await run('HISTORY'));
  expect(observed.slice(1, -1)).toEqual([
    'Signed in',
    'Opened board: GENERAL',
    'Opened thread: Relay desk notes',
    'Replied in Relay desk notes: Leave the note pending',
    'Read message: LAST ONE OUT',
    'Read message: LAST ONE OUT',
    'Viewed profile: ECHO',
    'Opened directory',
    'Viewed network directory',
    'Viewed door directory',
    'Launched door: RELAY TRIVIA',
  ]);
  await run('HELP');
  await run('DISCONNECT');
  expect(data.bbs.history).toEqual([
    { kind: 'sign-in' },
    { kind: 'board', id: 'general' },
    { kind: 'thread', id: 'relay-thread' },
    { kind: 'reply', id: 'relay-thread', choice: 'defer' },
    { kind: 'read', id: 'archive:lore.last-sysop' },
    { kind: 'read', id: 'archive:lore.last-sysop' },
    { kind: 'profile', id: 'echo-profile' },
    { kind: 'directory' },
    { kind: 'network' },
    { kind: 'doors' },
    { kind: 'door', id: 'relay-trivia' },
    { kind: 'disconnect' },
  ]);
  expect(JSON.stringify(JSON.parse(storage.value!).bbs.history)).not.toMatch(
    /Private Handle|garbage|visitor|statistics/i,
  );
  const restored = boardSession(sessionData(storage));
  runAll(restored.run, 'CONNECT', 'DESIGNATION');
  expect(lines(restored.run('HISTORY'))).toEqual(
    expect.arrayContaining(['Launched door: RELAY TRIVIA', 'Disconnected']),
  );
});

it('keeps applying local BBS effects when storage refuses writes, including future saves', () => {
  const storage = memoryStorage();
  const { data, persist, run } = boardSession(sessionData(storage));
  runAll(run, ...openThread);
  const newer = '{"schemaVersion":98,"opaque":"future bytes"}';
  storage.setItem('signal-lost.save', newer);
  storage.setItem.mockClear();
  expect(lines(run('REPLY acknowledge'))).toContain('Receipt filed');
  expect(data.bbs.replies).toEqual({ 'relay-thread': 'acknowledge' });
  expect(persist()).toBe(false);
  expect(storage.setItem).not.toHaveBeenCalled();
  expect(storage.value).toBe(newer);
});

it('hides the fixture command from actions and help and persists first discovery only', () => {
  const loaded = loadContent({ ...bundledFiles, ...discoveryFixture });
  expect(loaded.errors).toEqual([]);
  const { run, bbs, data, storage } = boardSession(sessionData(), loaded.content);
  expect(run('TUNECHECK').effect).toBeUndefined();
  run('CONNECT');
  expect(run('TUNECHECK').effect).toBeUndefined();
  run('DESIGNATION');
  function expectHidden(session: Pick<ReturnType<typeof boardSession>, 'run' | 'bbs'>) {
    expect(JSON.stringify(session.bbs.screen().actions)).not.toMatch(/tunecheck/i);
    expect(lines(session.run('HELP')).join(' ')).not.toMatch(/tunecheck/i);
  }
  const current = { run, bbs };
  for (const command of ['BOARDS', 'BOARD general', 'THREAD fixture-thread']) {
    expectHidden(current);
    const result = run(command);
    if (command.startsWith('THREAD'))
      expect(lines(result)).toContain('Type TUNECHECK to read the optional fixture.');
  }
  expect(run('TUNECHECK extra').effect).toBeUndefined();
  expect(lines(run('tUnEcHeCk'))).toContain('FIXTURE TUNING CONFIRMED.');
  expect(data.bbs.discoveries).toEqual(['fixture-secret']);
  expectHidden(current);
  const restored = boardSession(sessionData(storage), loaded.content);
  runAll(restored.run, 'CONNECT', 'DESIGNATION', 'PEOPLE');
  expectHidden(restored);
  const repeat = restored.run('TUNECHECK');
  expect(lines(repeat)).toContain('ALREADY DISCOVERED ON THIS TERMINAL.');
  expect(repeat.effect).toBeUndefined();
  expect(restored.data.bbs.history.filter(({ kind }) => kind === 'secret')).toEqual([
    { kind: 'secret', id: 'fixture-secret' },
  ]);
});

it('exposes a public bundled clue without requiring its optional command', () => {
  const { run, data, commands } = boardSession();
  runAll(run, ...openThread.slice(0, -1));
  expect(lines(run('THREAD relay-thread')).join(' ')).toContain('type LINECHECK');
  expect(commands()).not.toContain('LINECHECK');
  expect(lines(run('HELP')).join(' ')).not.toContain('LINECHECK');
  expect(lines(run('LiNeChEcK'))).toContain('LOCAL LINE CHECK COMPLETE.');
  expect(data.bbs.discoveries).toEqual(['linecheck']);
});

describe('the Q17 investigation', () => {
  const desk = {
    headers: {
      board: 'Q17 HEADER DESK',
      id: 'q17-header-desk',
      evidence: [
        [
          'THE FORGOTTEN BOARD',
          'Departure ledger',
          [
            'PACKET last present on 2001-03-02 | checkpoint 120.',
            'GHOST last present on 2001-03-03 | checkpoint 121.',
          ],
        ],
        [
          'Q17 HEADER DESK',
          'Q17 message headers',
          [
            'P17 / PACKET | WRITTEN 2001-03-01 18:10 | DELIVERED 141',
            'G17 / GHOST | WRITTEN 2001-03-02 09:20 | DELIVERED 142',
          ],
        ],
        [
          'Q17 HEADER DESK',
          'Queue policy',
          [
            'WRITTEN records sealed composition. DELIVERED records dispatch, not new authorship. A migration-held record released unchanged is DEFERRED.',
          ],
        ],
      ],
      rejection:
        'Read Departure ledger on THE FORGOTTEN BOARD, then Q17 message headers and Queue policy on this desk.',
      retry: 'Compare WRITTEN with DELIVERED',
      resultId: 'q17-header-confirmation',
      title: 'Q17 header confirmation',
      confirmation: 'DEFERRED VERIFIED / HEADER ANALYSIS',
      flag: 'deferred-headers-verified',
      echo: 'corrected my dispatch memory against those fields',
      sysop: 'HEADER PROOF ACCEPTED. CUSTODY AUDIT PENDING.',
    },
    custody: {
      board: 'Q17 CUSTODY DESK',
      id: 'q17-custody-desk',
      evidence: [
        [
          'Q17 CUSTODY DESK',
          'Sealed originals',
          [
            'P17 | PACKET | repair note | seal intact.',
            'G17 | GHOST | preservation note | seal intact.',
          ],
        ],
        [
          'Q17 CUSTODY DESK',
          'Dispatch comparison',
          [
            'P17 sealed original = P17 dispatch copy 141 | signature labels match | equality verified.',
            'G17 sealed original = G17 dispatch copy 142 | signature labels match | equality verified.',
          ],
        ],
        [
          'Q17 CUSTODY DESK',
          'Migration hold receipt',
          [
            'Q17: migration hold; sealed before departure; release unchanged after checkpoint 121.',
            'Custody policy classifies an unchanged release from migration hold as DEFERRED.',
          ],
        ],
      ],
      rejection:
        'Read Sealed originals, Dispatch comparison and Migration hold receipt before filing a custody finding.',
      retry: 'Reconcile the finding with the migration hold receipt',
      resultId: 'q17-custody-confirmation',
      title: 'Q17 custody confirmation',
      confirmation: 'DEFERRED VERIFIED / CUSTODY AUDIT',
      flag: 'deferred-custody-verified',
      echo: 'corrected my dispatch memory against SYSOP’s receipt',
      sysop: 'CUSTODY AUDIT FILED. BOTH DISPATCH COPIES MATCH',
    },
  } as const;
  type Journey = ReturnType<typeof boardSession>;
  type Desk = (typeof desk)[keyof typeof desk];
  const correction = 'Delivery is not authorship. I had those reversed.';
  const receipt = 'Queue receipt: Q17; search batch identifier.';
  const cases = Object.values(desk).flatMap((route) =>
    [true, false].map((forgeOpened) => ({ route, forgeOpened })),
  );
  const recovery = 'BOARD spool-02-recovery';
  const annex = 'BOARD maintenance-annex';
  const restore = 'APPLY SEAL / ROUTE / ACK';
  const receiptId = 'spool-02-restoration-receipt';
  const restoreFlag = 'spool-02-restored';
  const manifestFlag = 'manifest-r07-spool-02';
  const fragmentThread = 'THREAD maintenance-annex-fragments';
  const canonicalMode = 'RECONSTRUCT REPLAY / PRESERVE';
  const replayReceipt = 'spool-02-replay-receipt';
  const unassigned = 'unassigned-routing-entry';

  function start(forgeOpened = true, serviceOpened = true) {
    const flags = completedV1.flags.filter(
      (flag) =>
        (forgeOpened || flag !== 'forge-opened') &&
        (serviceOpened || flag !== 'service-panel-open'),
    );
    const puzzles = completedV1.puzzles.filter((id) => serviceOpened || id !== 'puzzle.service');
    const journey = boardSession(
      sessionData(memoryStorage(JSON.stringify({ ...completedV1, flags, puzzles }))),
    );
    expect(journey.status).toBe('migrated');
    expect(journey.data.flags.includes('forge-opened')).toBe(forgeOpened);
    expect(journey.data.flags.filter((flag) => flag.startsWith('deferred-'))).toEqual([]);
    expect(journey.data.bbsReadMessages).toEqual([]);
    expect(journey.data.events).toEqual({ fired: [], bulletins: [] });
    runAll(journey.run, 'CONNECT', 'DESIGNATION');
    return journey;
  }

  function reopen({ storage }: Journey) {
    const journey = boardSession(sessionData(storage));
    expect(journey.status).toBe('loaded');
    runAll(journey.run, 'CONNECT', 'DESIGNATION');
    return journey;
  }

  function select(journey: Journey, label: string) {
    const action = journey.bbs.screen().actions.find((entry) => entry.label === label);
    expect(action, `available action: ${label}`).toBeDefined();
    return journey.run(action!.command);
  }

  function openBoard(journey: Journey, label: string) {
    journey.run('MENU');
    select(journey, 'BOARDS');
    return select(journey, label);
  }

  function readThread(journey: Journey, board: string, thread: string) {
    openBoard(journey, board);
    return select(journey, thread);
  }

  function readConfirmation(journey: Journey, route: Desk) {
    journey.run('MENU');
    select(journey, 'MESSAGES');
    return select(journey, `${route.title} [READ]`);
  }

  function noWrite(journey: Journey, command: string) {
    const data = structuredClone(journey.data);
    const stored = journey.storage.value;
    journey.storage.setItem.mockClear();
    const result = journey.run(command);
    expect(result.effect).toBeUndefined();
    expect(journey.data).toEqual(data);
    expect(journey.storage.value).toBe(stored);
    expect(journey.storage.setItem).not.toHaveBeenCalled();
    return lines(result);
  }

  function discover(journey: Journey) {
    const index = readThread(journey, 'THE FORGOTTEN BOARD', 'Delivered messages and queue index');
    expect(lines(index)).toContain(receipt);
    const found = journey.run('SEARCH Q17');
    expect(lines(found)).toContain('Q17 batch located');
    return index;
  }

  function gather(journey: Journey, route: Desk, omit?: string) {
    for (const [board, thread, clues] of route.evidence) {
      if (thread === omit) continue;
      const found = lines(readThread(journey, board, thread));
      expect(found).toEqual(expect.arrayContaining([...clues]));
    }
    const opened = openBoard(journey, route.board);
    expect(lines(opened)).toContain(journey.bbs.screen().hint);
  }

  function voices(journey: Journey) {
    journey.run('MENU');
    const sysop = lines(select(journey, 'SYSOP')).join(' ');
    journey.run('MENU');
    select(journey, 'PEOPLE');
    select(journey, 'ECHO');
    const echo = lines(select(journey, 'TALK')).join(' ');
    return { sysop, echo };
  }

  function archivedVoices(journey: Journey) {
    journey.run('MENU');
    select(journey, 'PEOPLE');
    for (const [handle, signature] of [
      ['PACKET', 'P17'],
      ['GHOST', 'G17'],
    ] as const) {
      const profile = select(journey, handle);
      expect(profile.output[0]).toMatchObject({ tone: 'history', origin: 'fictional' });
      expect(lines(profile).join(' ')).toContain('Fictional historical record');
      expect(lines(profile).join(' ')).toContain(`Signed note ${signature}`);
      expect(journey.commands()).not.toContain('TALK');
      expect(noWrite(journey, 'TALK')).toContain('COMMAND UNAVAILABLE HERE.');
      journey.run('BACK');
    }

    const index = readThread(journey, 'THE FORGOTTEN BOARD', 'Delivered messages and queue index');
    const posts = index.output.filter(({ origin }) => origin === 'fictional');
    expect(posts.map((post) => [post.tone, post.lines[0]])).toEqual([
      ['history', '141 / PACKET / P17'],
      ['history', '142 / GHOST / G17'],
      ['history', 'Retained queue index'],
    ]);
    expect(posts[0]?.lines).toContain('Acknowledge receipt. Even if it took a while.');
    expect(posts[1]?.lines).toContain(
      'Keep the signature with the note when you move it. Otherwise the copy remembers the words and forgets whose they were.',
    );
  }

  function expectHandoffBoundary(journey: Journey) {
    journey.run('MENU');
    const sysop = lines(select(journey, 'SYSOP'));
    journey.run('MENU');
    const boards = lines(select(journey, 'BOARDS'));
    const boardLabels = journey.bbs.screen().actions.map(({ label }) => label);
    journey.run('MENU');
    const directory = lines(select(journey, 'DIRECTORY'));
    const network = lines(select(journey, 'NETWORK'));
    const labels = lines(readThread(journey, 'THE FORGOTTEN BOARD', 'Damaged recovery directory'));
    expect(labels).toEqual(
      expect.arrayContaining([
        'queue-reader | INACCESSIBLE',
        'signature-checker | INACCESSIBLE',
        'replay-writer | INACCESSIBLE',
      ]),
    );
    expect(
      [...sysop, ...boards, ...boardLabels, ...directory, ...network, ...labels].join(' '),
    ).not.toMatch(/MAINTAINER|MAINTENANCE ANNEX|TRAINING SHELF/i);
    expect(network.join(' ')).not.toContain('SPOOL-02');
    expect(journey.data.flags).not.toContain(restoreFlag);
  }

  function submit(journey: Journey, route: Desk) {
    expect(journey.data.events.bulletins).not.toContain(route.resultId);
    journey.storage.setItem.mockClear();
    const result = journey.run('  sUbMiT   dEfErReD  ');
    expect(lines(result)).toContain(route.confirmation);
    expect(lines(result).join(' ')).toContain(correction);
    expect(journey.storage.setItem).toHaveBeenCalledOnce();
    const [, bytes] = journey.storage.setItem.mock.calls[0]!;
    expect(JSON.parse(bytes)).toMatchObject({
      bbs: { history: expect.arrayContaining([{ kind: 'read', id: `message:${route.resultId}` }]) },
      bbsReadMessages: expect.arrayContaining([`message:${route.resultId}`]),
      flags: expect.arrayContaining([route.flag, 'deferred-verified']),
      events: {
        fired: expect.arrayContaining([route.resultId]),
        bulletins: expect.arrayContaining([route.resultId]),
      },
    });
  }

  it('reveals both desks only after the index-backed search and retains the Act I evidence', () => {
    const journey = start();
    select(journey, 'BOARDS');
    for (const route of Object.values(desk)) {
      expect(journey.commands()).not.toContain(`BOARD ${route.id}`);
      expect(noWrite(journey, `BOARD ${route.id}`)).toContain('COMMAND UNAVAILABLE HERE.');
    }
    const search = select(journey, 'THE FORGOTTEN BOARD');
    expect(lines(search)).toContain('Type SEARCH <batch id> to locate a queued batch.');
    expect(noWrite(journey, 'SEARCH Q17').join(' ')).toContain(
      'Read Delivered messages and queue index',
    );

    const farewell = select(journey, 'Keel’s farewell');
    const original = content.archives.find(({ id }) => id === 'lore.last-sysop')!;
    expect(farewell.output[1]?.lines).toEqual([
      'LAST ONE OUT',
      'FROM: TKEEL',
      'DATE: 2001-03-01',
      ...original.body,
    ]);
    journey.run('BACK');
    expect(lines(select(journey, 'Delivered messages and queue index'))).toContain(receipt);
    expect(noWrite(journey, 'SEARCH Q18').join(' ')).toContain(
      'Check the identifier on the queue receipt',
    );
    journey.run('BACK');
    expect(lines(select(journey, 'Delivered messages and queue index'))).toContain(receipt);
    expect(journey.data.events.fired).toEqual([]);

    journey.storage.setItem.mockClear();
    expect(lines(journey.run('  SeArCh  q17  '))).toContain('Q17 batch located');
    expect(journey.storage.setItem).toHaveBeenCalledOnce();
    expect(JSON.parse(journey.storage.value!)).toMatchObject({
      bbsReadMessages: expect.arrayContaining(['message:q17-batch-located']),
      flags: expect.arrayContaining(['deferred-batch-located']),
      events: { fired: ['q17-batch-located'], bulletins: ['q17-batch-located'] },
    });
    expect(noWrite(journey, 'SEARCH Q17')).toContain('Q17 batch located');
    journey.run('MENU');
    select(journey, 'BOARDS');
    expect(journey.commands()).toEqual(
      expect.arrayContaining(['BOARD q17-header-desk', 'BOARD q17-custody-desk']),
    );
    expectHandoffBoundary(journey);
  });

  it.each(cases)(
    'reaches $route.title independently with FORGE opened=$forgeOpened',
    ({ route, forgeOpened }) => {
      const journey = start(forgeOpened);
      expect(lines(readThread(journey, 'THE FORGOTTEN BOARD', 'Keel’s farewell'))).toContain(
        'LAST ONE OUT',
      );
      expect(
        lines(readThread(journey, 'THE FORGOTTEN BOARD', 'Damaged recovery directory')),
      ).toContain('DAMAGED DIRECTORY / LABELS ONLY');
      readThread(journey, 'GENERAL', 'Relay desk notes');
      discover(journey);
      const before = voices(journey);
      expect(before.echo).toContain('SYSOP refuses to let me change the index');
      expect(before.echo).toContain('Q17 HEADER DESK');
      expect(before.sysop).toContain('DO NOT OVERWRITE THE INDEX');
      expect(before.sysop).toContain('CUSTODY ACCOUNTING');
      archivedVoices(journey);

      gather(journey, route);
      journey.run('MENU');
      select(journey, 'MESSAGES');
      expect(journey.bbs.screen().actions.some(({ label }) => label.includes(route.title))).toBe(
        false,
      );
      openBoard(journey, route.board);
      expect(noWrite(journey, 'SUBMIT IMPERSONATED').join(' ')).toContain(route.retry);
      expect(noWrite(journey, 'SUBMIT DEFERRED EXTRA').join(' ')).toContain(route.retry);
      submit(journey, route);
      expect(journey.data.flags.filter((flag) => flag.startsWith('deferred-'))).toEqual([
        'deferred-batch-located',
        route.flag,
        'deferred-verified',
      ]);
      expect(lines(readConfirmation(journey, route))).toContain(route.confirmation);

      const restored = reopen(journey);
      openBoard(restored, route.board);
      expect(noWrite(restored, 'SUBMIT DEFERRED')).toContain(route.confirmation);
      expect(restored.data.events).toEqual({
        fired: ['relay-read', 'relay-bulletin', 'q17-batch-located', route.resultId],
        bulletins: ['relay-bulletin', 'q17-batch-located', route.resultId],
      });
      expect(restored.data.flags).toContain('deferred-verified');
      expect(lines(readConfirmation(restored, route))).toContain(route.confirmation);
      const after = voices(restored);
      expect(after.echo).toContain(route.echo);
      expect(after.sysop).toContain(route.sysop);
      archivedVoices(restored);
      expectHandoffBoundary(restored);
    },
  );

  async function liveSession(session: ReturnType<typeof sessionData>, records = content) {
    const { data, persist } = session;
    const settle = (candidate: typeof data) => settleEvents(records.events, candidate);
    const host = createDoorHost(createDoorRegistry(records.doors), data, persist, settle);
    const progress = createBbsProgress(data, settle, persist, records.episodes);
    const game = createGame({ content: records, data, persist });
    const voices = createDialogueSources(records.characters);
    const bbs = createBbsDoorSession(
      getBbsOffer(records, factsOf(data))!,
      () => data,
      host,
      (id) => {
        const source = voices.get(id);
        return source && game.say(source, 'bbs');
      },
      progress.applyCompletion,
    );
    async function dispatch(command: string) {
      const offline = bbs.screen().phase === 'offline';
      const result = (await bbs.dispatch(command))!;
      if (offline && bbs.screen().phase === 'login') expect(progress.connect()).toBe(true);
      return { result, saved: !result.effect || progress.apply(result.effect) };
    }
    async function run(command: string) {
      const { result, saved } = await dispatch(command);
      expect(saved).toBe(true);
      return lines(result);
    }
    async function noWrite(command: string) {
      const before = structuredClone(data);
      const bytes = session.storage.value;
      session.storage.setItem.mockClear();
      const output = await dispatch(command);
      expect(output.result.effect).toBeUndefined();
      expect(output.result.completion).toBeUndefined();
      expect(data).toEqual(before);
      expect(session.storage.value).toBe(bytes);
      expect(session.storage.setItem).not.toHaveBeenCalled();
      return lines(output.result);
    }
    await run('CONNECT');
    await run('DESIGNATION');
    return {
      ...session,
      bbs,
      run,
      dispatch,
      noWrite,
      commands: () => bbs.screen().actions.map(({ command }) => command),
    };
  }

  type LiveSession = Awaited<ReturnType<typeof liveSession>>;

  async function liveVoices({ run }: LiveSession) {
    await run('MENU');
    const sysop = (await run('SYSOP')).join(' ');
    await run('MENU');
    await run('PEOPLE');
    await run('PROFILE echo-profile');
    return { sysop, echo: (await run('TALK')).join(' ') };
  }

  function expectWorld(data: LiveSession['data'], restored: boolean, forgeOpened: boolean) {
    const facts = factsOf(data);
    const nodes = mapNodes(content.sectors, facts);
    const spool = nodes.find(({ sector }) => sector.id === 'spool-02');
    if (restored) {
      expect(spool).toMatchObject({ enterable: true, sector: { name: 'SPOOL-02' } });
    } else {
      expect(spool).toBeUndefined();
    }
    const observatory = nodes.find(({ sector }) => sector.id === 'silent-observatory');
    expect(observatory?.enterable).toBe(false);
    expect(observatory?.sector.lockedText.join(' ')).toContain('NO CARRIER');
    expect(observatory?.sector.lockedText.join(' ')).toContain(
      '2 OBSERVERS REQUIRED. OBSERVERS ONLINE: 1.',
    );
    expect(deriveAccessLevel(content.accessLevels, facts)).toMatchObject(
      restored ? { rank: 2, label: 'MAINTAINER' } : { rank: 1, label: 'RELAY' },
    );
    const forge = content.artifacts.find(({ id }) => id === 'forge')!;
    expect(forge.requires).toBe('flag:service-panel-open');
    expect(evaluate(forge.requires, facts)).toBe(true);
    expect(facts.has('flag:forge-opened')).toBe(forgeOpened);
    expect(data.episodes).toEqual(completedV1.episodes);
    expect(data.profile.designation).toBe(completedV1.designation);
  }

  async function openRecovery(session: LiveSession) {
    await session.run('MENU');
    await session.run('DIRECTORY');
    expect(session.commands()).toContain(recovery);
    expect(await session.run(recovery)).toEqual(
      expect.arrayContaining([
        'TARGET: RELAY 07 / SPOOL-02',
        'RESTORE WORKING SPOOL. RETAIN SEALED ORIGINALS.',
      ]),
    );
  }

  async function expectLocked(session: LiveSession, forgeOpened: boolean) {
    expectWorld(session.data, false, forgeOpened);
    expect(session.data.flags).not.toContain(restoreFlag);
    await session.run('MENU');
    await session.run('DIRECTORY');
    expect(session.commands()).not.toContain(annex);
    expect(await session.noWrite(annex)).toContain('COMMAND UNAVAILABLE HERE.');
    expect((await session.run('NETWORK')).join(' ')).not.toContain('SPOOL-02');
    await session.run('MENU');
    await session.run('MESSAGES');
    expect(
      session.bbs
        .screen()
        .actions.map(({ label }) => label)
        .join(' '),
    ).not.toContain('SPOOL-02 restoration receipt');
  }

  async function finishRestoration(
    session: LiveSession,
    proofRoutes: Desk[],
    forgeOpened: boolean,
  ) {
    const { run, noWrite, bbs, data, storage } = session;
    const receiptKey = `message:${receiptId}`;
    const wrongOrder = 'ACK needs a destination receipt. Review the training notebook and retry.';
    const invalidOrder =
      'Enter each operation once, separated by /. Review the training notebook and retry.';
    const receiptLine = 'SPOOL-02 WORKING SPOOL RESTORED. SEALED ORIGINALS PRESERVED.';
    const action = (command: string) =>
      bbs.screen().actions.find((entry) => entry.command === command);

    await run('MENU');
    await run('BOARDS');
    expect(session.commands()).not.toContain(recovery);
    expect(await noWrite(recovery)).toContain('COMMAND UNAVAILABLE HERE.');
    await openRecovery(session);
    expect(bbs.screen().hint).toContain('Apply the training shelf procedure.');
    expect(session.commands().filter((command) => command.startsWith('ORDER '))).toEqual([
      'ORDER ACK',
      'ORDER ROUTE',
      'ORDER SEAL',
    ]);
    expect(action('APPLY')?.disabled).toBe(true);
    expect(action('CLEAR')?.disabled).toBe(true);
    expect(await noWrite('APPLY SEAL / ACK / ROUTE')).toContain(wrongOrder);

    await expectLocked(session, forgeOpened);
    const before = await liveVoices(session);
    expect(before.echo).toContain(
      proofRoutes.length === 1 ? proofRoutes[0]!.echo : 'Both records stay on file.',
    );
    expect(before.sysop).toContain(
      proofRoutes.length === 1 ? proofRoutes[0]!.sysop : 'HEADER PROOF AND CUSTODY AUDIT FILED.',
    );

    await openRecovery(session);
    for (const invalid of [
      'APPLY',
      'APPLY SEAL / ROUTE',
      'APPLY SEAL / SEAL / ACK',
      'APPLY SEAL / ROUTE / SEND',
      'APPLY SEAL / ROUTE / ACK EXTRA',
      'APPLY SEAL / ROUTE / ACK / ACK',
    ]) {
      expect(await noWrite(invalid)).toContain(invalidOrder);
    }
    expect(await noWrite('ORDER SEAL')).toContain('STAGED ORDER: SEAL');
    expect(action('ORDER SEAL')).toMatchObject({ selected: true, disabled: true });
    expect(action('CLEAR')?.disabled).toBe(false);
    expect(await noWrite('CLEAR')).toContain('STAGED ORDER: EMPTY');
    expect(action('ORDER SEAL')).toMatchObject({ selected: false, disabled: false });
    await noWrite('ORDER SEAL');
    await noWrite('ORDER ACK');
    expect(await noWrite('ORDER ROUTE')).toContain('STAGED ORDER: SEAL / ACK / ROUTE');
    expect(action('APPLY')?.disabled).toBe(false);
    expect(await noWrite('APPLY')).toContain(wrongOrder);
    await noWrite('BACK');
    expect(bbs.screen().phase).toBe('directory');
    await run(recovery);
    expect(action('APPLY')?.disabled).toBe(true);

    if (proofRoutes.length === 2) {
      const refused = await liveSession(sessionData(memoryStorage(storage.value)));
      await openRecovery(refused);
      const bytes = refused.storage.value;
      refused.storage.setItem.mockImplementationOnce(() => {
        throw new Error('save refused');
      });
      const output = await refused.dispatch(restore);
      expect(output.saved).toBe(false);
      expect(lines(output.result)).toContain(receiptLine);
      expect(refused.data.flags).toContain(restoreFlag);
      expect(refused.storage.value).toBe(bytes);
      await refused.run('BACK');
      expect(refused.commands()).toContain(annex);
    }

    const application = forgeOpened ? '  aPpLy  seal/  Route / ack  ' : 'APPLY';
    if (!forgeOpened) {
      for (const token of ['SEAL', 'ROUTE', 'ACK']) await noWrite(`ORDER ${token}`);
    }
    const expected = structuredClone(data);
    expected.flags.push(restoreFlag);
    expected.bbs.history.push({ kind: 'read', id: receiptKey });
    expected.bbsReadMessages.push(receiptKey);
    expected.events.fired.push(restoreFlag);
    expected.events.bulletins.push(receiptId);
    storage.setItem.mockClear();
    const restored = await session.dispatch(application);
    expect(restored.saved).toBe(true);
    expect(restored.result.effect).toEqual({
      history: { kind: 'read', id: receiptKey },
      readKeys: [receiptKey],
    });
    const output = lines(restored.result);
    expect(output).toContain(receiptLine);
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(data).toEqual(expected);
    const reloaded = sessionData(storage);
    expect(reloaded.status).toBe('loaded');
    expect(reloaded.data).toEqual(expected);
    await run('BACK');
    expect(bbs.screen().phase).toBe('directory');
    expect(session.commands()).toContain(annex);

    const next = await liveSession(reloaded);
    expectWorld(next.data, true, forgeOpened);
    await openRecovery(next);
    expect(await next.noWrite(restore)).toEqual(output);
    expect(next.data.flags.filter((flag) => flag === restoreFlag)).toEqual([restoreFlag]);
    await next.run('BACK');
    expect(await next.run('NETWORK')).toEqual(
      expect.arrayContaining(['SPOOL-02 | AVAILABLE', 'SILENT OBSERVATORY | RESTRICTED']),
    );
    await next.run('BACK');
    await next.run('DOORS');
    expect(next.commands().filter((command) => command.startsWith('OPEN '))).toEqual([
      'OPEN forgotten-archive',
      'OPEN relay-trivia',
      'OPEN signal-hunter',
      'OPEN relay-trader',
    ]);
    await next.run('BACK');
    expect(next.commands()).toContain(annex);
    expect(await next.run(annex)).toContain('SPOOL-02 BUILD RECIPE: SC-1 → QR-1 → RW-1');
    const thread = 'THREAD maintenance-annex-fragments';
    expect(next.commands()).toContain(thread);
    expect(await next.run(thread)).toEqual(
      expect.arrayContaining([
        'BEGIN signature-checker / SC-1',
        'REQUIRES: none. Verifies the seal on each stored record.',
        'END signature-checker / SEAL SC-1 VERIFIED',
        'GHOST: Keep the original seal with the record. A verified copy needs a trace back.',
        'BEGIN queue-reader / QR-1',
        'REQUIRES: SC-1. Admits only verified records.',
        'END queue-reader / SEAL QR-1 VERIFIED',
        'PACKET: Check the seal before the queue. Saves routing a bad copy twice.',
        'BEGIN replay-writer / RW-1',
        'REQUIRES: QR-1 and SC-1. Writes verified dispatch to a separate replay copy.',
        'END replay-writer / SEAL RW-1 VERIFIED',
      ]),
    );
    await next.run('BACK');
    expect(next.commands()).toContain(thread);
    await next.run('BACK');
    expect(next.bbs.screen().phase).toBe('directory');
    expect(await next.run('MENU')).toContain('ACCESS LEVEL: MAINTAINER');
    expect(await liveVoices(next)).toEqual({
      echo: 'ECHO: The Annex shows which fragments the queue reader and replay writer depend on. I can read those dependencies now.',
      sysop: 'MAINTAINER GRANTED. ORIGINAL REMAINS READ-ONLY. WORKING COPY ACCESS ONLY.',
    });
    const bbsJourney = boardSession(next);
    runAll(bbsJourney.run, 'CONNECT', 'DESIGNATION');
    for (const route of proofRoutes) {
      expect(lines(readConfirmation(bbsJourney, route))).toContain(route.confirmation);
    }
    archivedVoices(bbsJourney);
  }

  it.each(cases)(
    'restores SPOOL-02 through $route.title and the training shelf with FORGE opened=$forgeOpened',
    async ({ route, forgeOpened }) => {
      const journey = start(forgeOpened);
      const openCommand = 'OPEN forgotten-archive';
      const learnedFlag = 'spool-02-order-learned';
      const order = 'SEAL / ROUTE / ACK';
      const inspectFirst = 'Inspect all three training fragments before recording the procedure.';

      async function expectClosed() {
        const directory = await liveSession(journey);
        await directory.run('DOORS');
        expect(directory.commands()).not.toContain(openCommand);
        expect(directory.commands().filter((command) => command.startsWith('OPEN '))).toEqual([
          'OPEN relay-trivia',
        ]);
        expect(await directory.run(openCommand)).toContain('DOOR UNAVAILABLE.');
        expect(directory.bbs.screen().phase).toBe('doors');
      }

      const unproven = await liveSession(journey);
      await expectLocked(unproven, forgeOpened);
      await unproven.run('MENU');
      await unproven.run('DIRECTORY');
      expect(unproven.commands()).not.toContain(recovery);
      expect(await unproven.noWrite(recovery)).toContain('COMMAND UNAVAILABLE HERE.');
      expect(await unproven.noWrite(restore)).toContain('COMMAND UNAVAILABLE HERE.');

      await expectClosed();
      discover(journey);
      await expectClosed();
      gather(journey, route);
      await expectClosed();
      expect(noWrite(journey, 'SUBMIT IMPERSONATED').join(' ')).toContain(route.retry);
      await expectClosed();
      submit(journey, route);
      expect(journey.data.flags.filter((flag) => flag.startsWith('deferred-'))).toEqual([
        'deferred-batch-located',
        route.flag,
        'deferred-verified',
      ]);

      const initial = await liveSession(journey);
      await expectLocked(initial, forgeOpened);
      await openRecovery(initial);
      expect(initial.commands()).toEqual(['BACK', 'MENU', 'HELP', 'DISCONNECT']);
      expect(await initial.noWrite(restore)).toContain(
        'Training required. Learn the procedure at The Forgotten Archive shelf.',
      );
      await initial.run('MENU');
      await initial.run('DOORS');
      expect(initial.commands()).toContain(openCommand);
      expect(await initial.run(openCommand)).toContain('ARCHIVE VESTIBULE');
      expect(await initial.run('TRAINING SHELF')).toContain('TRAINING SHELF');
      expect(await initial.run(order)).toContain(inspectFirst);
      expect(factsOf(journey.data).has(`flag:${learnedFlag}`)).toBe(false);
      await initial.run('INSPECT SEAL FRAGMENT');
      await initial.run('INSPECT ROUTE FRAGMENT');

      const partial = sessionData(journey.storage);
      expect(partial.status).toBe('loaded');
      expect(partial.data.doorState['forgotten-archive']).toEqual({
        version: 1,
        payload: {
          locationId: 'training-shelf',
          inspectedItemIds: ['route-fragment', 'seal-fragment'],
          flags: [],
          endingId: null,
        },
      });
      const restored = await liveSession(partial);
      await restored.run('DOORS');
      expect(await restored.run(openCommand)).toContain('TRAINING SHELF');
      expect(await restored.run('SEAL / ACK / ROUTE')).toContain(
        'ACK is missing the destination receipt.',
      );
      expect(await restored.run(order)).toContain(inspectFirst);
      expect(restored.commands()).not.toContain('NOTEBOOK');
      expect(factsOf(partial.data).has(`flag:${learnedFlag}`)).toBe(false);
      const fragmentReads = [
        ['SEAL', 'SEAL fixes an immutable original'],
        ['ROUTE', 'ROUTE requires the seal reference'],
        ['ACK', 'ACK requires the destination receipt'],
      ];
      for (const [command, text] of fragmentReads) {
        const inspect = `INSPECT ${command} FRAGMENT`;
        const fragment = await restored.run(inspect);
        expect(fragment.join(' ')).toContain(text);
        expect(await restored.run(inspect)).toEqual(fragment);
      }
      expect(factsOf(partial.data).has(`flag:${learnedFlag}`)).toBe(false);
      expect(await restored.run(order)).toContain(
        'PROCEDURE LEARNED. The training notebook is available.',
      );
      expect(factsOf(partial.data).has(`flag:${learnedFlag}`)).toBe(true);
      expect(
        JSON.parse(journey.storage.value!).flags.filter((flag: string) => flag === learnedFlag),
      ).toEqual([learnedFlag]);
      expect(partial.data.flags.some((flag) => flag.startsWith('forgotten-archive-'))).toBe(false);
      expect(await restored.run('NOTEBOOK')).toContain(`TRAINING NOTEBOOK: ${order}.`);
      const menu = await restored.run('EXIT');
      expect(menu).toContain('DEEP FIELD MAIN MENU');
      expect(menu).toContain('TRAINING COMPLETE. Open DIRECTORY / RECOVERY CONSOLE.');
      expect(restored.bbs.screen().phase).toBe('menu');

      const afterExit = sessionData(journey.storage);
      expect(afterExit.status).toBe('loaded');
      expect(afterExit.data.flags).toEqual([...journey.data.flags, learnedFlag]);
      expect(afterExit.data.episodes).toEqual(journey.data.episodes);
      expect(afterExit.data.locations).toEqual(journey.data.locations);
      const reopened = await liveSession(afterExit);
      await reopened.run('DOORS');
      await reopened.run(openCommand);
      expect(await reopened.run('VESTIBULE')).toContain('ARCHIVE VESTIBULE');
      expect(await reopened.run('NOTEBOOK')).toContain(`TRAINING NOTEBOOK: ${order}.`);
      expect(factsOf(afterExit.data)).toEqual(
        new Set([...factsOf(journey.data), `flag:${learnedFlag}`]),
      );
      expect([...menu, ...(await reopened.run('EXIT'))].join(' ')).not.toMatch(
        /restored|restoration|maintenance annex|chapter complete/i,
      );

      const knowledgeOnly = JSON.parse(journey.storage.value!) as { flags: string[] };
      knowledgeOnly.flags = knowledgeOnly.flags.filter((flag) => flag !== 'deferred-verified');
      const withoutProof = await liveSession(
        sessionData(memoryStorage(JSON.stringify(knowledgeOnly))),
      );
      expect(withoutProof.data.events.fired).toContain(route.resultId);
      expect(withoutProof.data.flags).toContain(learnedFlag);
      expect(withoutProof.data.flags).not.toContain('deferred-verified');
      await openRecovery(withoutProof);
      expect(withoutProof.commands()).toEqual(['BACK', 'MENU', 'HELP', 'DISCONNECT']);
      expect(await withoutProof.noWrite(restore)).toContain(
        'Q17 proof required. Verify the deferred release at either Q17 desk.',
      );

      const proofRoutes = [route];
      if (route === desk.custody && forgeOpened) {
        const both = boardSession(afterExit);
        runAll(both.run, 'CONNECT', 'DESIGNATION');
        gather(both, desk.headers);
        submit(both, desk.headers);
        proofRoutes.push(desk.headers);
      }
      await finishRestoration(reopened, proofRoutes, forgeOpened);
    },
  );

  async function openAnnex({ run }: LiveSession) {
    await run('MENU');
    await run('DIRECTORY');
    return run(annex);
  }

  async function expectUnpublished(session: LiveSession) {
    expect(session.data.episodes).not.toContain('episode.002');
    expect(session.data.events.bulletins).not.toContain(replayReceipt);
    expect(session.data.events.bulletins).not.toContain(unassigned);
    await session.run('MENU');
    await session.run('MESSAGES');
    const offered = session.bbs.screen().actions;
    expect(offered.map(({ label }) => label).join(' ')).not.toMatch(/replay receipt|UNASSIGNED/);
    const nextRead = offered.filter(({ command }) => command.startsWith('READ ')).length + 1;
    expect(await session.noWrite(`READ ${nextRead}`)).toContain('SELECT A MESSAGE FROM THE LIST.');
  }

  function hubToolIds(data: LiveSession['data']) {
    const entry = projectEntryContent(content);
    const game = createGame({ content: entry, data, persist: () => undefined });
    return buildTools({
      content: entry,
      game,
      audio: createAudio(),
      echo: createDialogueSources(entry.characters).get('echo')!,
      utilities: [],
      onEpisodeComplete: () => undefined,
    }).map(({ id }) => id);
  }

  const finaleCases = [
    { proof: desk.headers, door: 'signal-hunter', forge: false },
    { proof: desk.headers, door: 'relay-trader', forge: true },
    { proof: desk.custody, door: 'signal-hunter', forge: true },
    { proof: desk.custody, door: 'relay-trader', forge: false },
  ];

  it.each(finaleCases)(
    'completes Chapter 2 through $proof.board and $door',
    async ({ proof, door, forge }) => {
      const prior = start(forge, forge);
      const { data, storage } = prior;
      await expectUnpublished(await liveSession(prior));
      discover(prior);
      gather(prior, proof);
      submit(prior, proof);
      expect(
        data.flags.filter((flag) => /^deferred-(headers|custody)-verified$/.test(flag)),
      ).toEqual([proof.flag]);

      const session = await liveSession(prior);
      const { run, noWrite, bbs } = session;
      await run('DOORS');
      await run('OPEN forgotten-archive');
      await run('TRAINING SHELF');
      for (const fragment of ['SEAL', 'ROUTE', 'ACK']) await run(`INSPECT ${fragment} FRAGMENT`);
      expect(await run('SEAL / ROUTE / ACK')).toContain(
        'PROCEDURE LEARNED. The training notebook is available.',
      );
      await run('EXIT');
      await openRecovery(session);
      expect(await run(restore)).toContain(
        'SPOOL-02 WORKING SPOOL RESTORED. SEALED ORIGINALS PRESERVED.',
      );
      await run('MENU');
      await run('DOORS');
      await run(`OPEN ${door}`);
      let signed: string[];
      if (door === 'signal-hunter') {
        expect((await run('VERIFY H1')).join(' ')).toContain('RELAY-07');
        expect((await run('VERIFY H2')).join(' ')).toContain('DAMAGED');
        expect(data.flags).not.toContain(manifestFlag);
        signed = await run('VERIFY H3');
      } else {
        expect((await run('CLAIM ENVELOPE')).join(' ')).toContain('envelope');
        await run('STAMP ACK SPOOL-02');
        signed = await run('EXCHANGE');
      }
      expect(signed).toContain('SIGNED REPAIR MANIFEST R07-SPOOL-02');
      expect(data.flags.filter((flag) => flag === manifestFlag)).toEqual([manifestFlag]);
      await run('EXIT');
      expect(data.doorState).not.toHaveProperty(
        door === 'signal-hunter' ? 'relay-trader' : 'signal-hunter',
      );
      await expectUnpublished(session);

      expect(await openAnnex(session)).toContain('SPOOL-02 BUILD RECIPE: SC-1 → QR-1 → RW-1');
      expect(session.commands()).not.toContain('COMPARE');
      await run(fragmentThread);
      await run('BACK');
      expect(await noWrite(canonicalMode)).toEqual([
        'COMPARE the retained fragments and recipe with the verified manifest first.',
      ]);
      expect(await noWrite('CREDITS')).toContain('COMMAND UNAVAILABLE HERE.');
      const comparison = await noWrite('COMPARE');
      expect(comparison).toEqual(
        expect.arrayContaining([
          'SC-1 / signature-checker | REQUIRES: none | BOUNDARY: COMPLETE',
          'QR-1 / queue-reader | REQUIRES: SC-1 | BOUNDARY: COMPLETE',
          'RW-1 / replay-writer | REQUIRES: QR-1 and SC-1 | BOUNDARY: COMPLETE',
          'BUILD ORDER: SC-1 → QR-1 → RW-1',
          'DESTINATION: separate replay copy. Preserve sealed originals unchanged.',
        ]),
      );
      expect(await noWrite('COMPARE')).toEqual(comparison);
      expect(
        bbs
          .screen()
          .actions.filter(({ command }) => command.startsWith('RECONSTRUCT '))
          .map(({ label }) => label),
      ).toEqual(['REPLAY / PRESERVE', 'REPLAY / REPLACE', 'RESET / PRESERVE', 'RESET / REPLACE']);
      expect(await noWrite('RECONSTRUCT REPLAY / REPLACE')).toContain(
        'REPLACE would overwrite the sealed originals and lose their custody record.',
      );
      await expectUnpublished(session);
      await openAnnex(session);
      expect(await noWrite(canonicalMode)).toContain(
        'COMPARE the retained fragments and recipe with the verified manifest first.',
      );
      await run('COMPARE');

      const before = structuredClone(data);
      const tools = hubToolIds(data);
      storage.setItem.mockClear();
      const { result } = await session.dispatch(canonicalMode);
      expect(result.effect).toBeUndefined();
      expect(storage.setItem).toHaveBeenCalledOnce();
      const completion = result.completion!;
      expect(completion.episode.id).toBe('episode.002');
      const indexes = completion.audit.filter((line) => line.startsWith('DELIVERY '));
      expect(indexes).toEqual([
        'DELIVERY 141 / P17 | REPLAY SEAL P17 = ORIGINAL SEAL P17',
        'DELIVERY 142 / G17 | REPLAY SEAL G17 = ORIGINAL SEAL G17',
      ]);
      expect(completion.audit.join(' ')).toContain(
        'Q17: migration hold; sealed before departure; release unchanged after checkpoint 121.',
      );
      expect(data).toEqual({
        ...before,
        episodes: ['episode.000', 'episode.002'],
        bbs: {
          ...before.bbs,
          history: [...before.bbs.history, { kind: 'read', id: `message:${replayReceipt}` }],
        },
        bbsReadMessages: [...before.bbsReadMessages, `message:${replayReceipt}`],
        events: {
          fired: [...before.events.fired, 'spool-02-reconstructed', unassigned],
          bulletins: [...before.events.bulletins, replayReceipt, unassigned],
        },
      });
      expect(hubToolIds(data)).toEqual(tools);

      const saved = sessionData(storage);
      expect(saved.data).toEqual(data);
      const reloaded = await liveSession(saved);
      await openAnnex(reloaded);
      expect(await reloaded.noWrite(canonicalMode)).toEqual(
        expect.arrayContaining([...completion.audit]),
      );
      const credits = await reloaded.dispatch('CREDITS');
      expect(credits.result.opensCredits?.heading).toBe('Contributor record');
      expect(credits.result.effect).toBeUndefined();
      expect(reloaded.bbs.screen().phase).toBe('credits');
      await reloaded.run('BACK');
      expect(reloaded.commands()).toContain(fragmentThread);
      const comments = await liveVoices(reloaded);
      expect(comments.sysop).toContain('BOTH ORIGINALS REMAIN SEALED AND READ-ONLY.');
      expect(comments.echo).toContain('I can cite the SPOOL-02 receipt');
      await reloaded.run('MENU');
      await reloaded.run('MESSAGES');
      const discovery = reloaded.bbs
        .screen()
        .actions.find(({ label }) => label.startsWith('UNASSIGNED'));
      expect(discovery?.label).toContain('[NEW]');
      expect(await reloaded.run(discovery!.command)).toEqual(
        expect.arrayContaining([
          'REGISTERED OPERATOR: [EMPTY]',
          'Who prepared a destination with no registered operator?',
        ]),
      );
      await reloaded.run('MENU');
      await reloaded.run('DIRECTORY');
      expect(reloaded.commands()).toEqual(expect.arrayContaining([annex, recovery, 'DOORS']));
      expect(await reloaded.run('NETWORK')).toEqual(
        expect.arrayContaining(['SPOOL-02 | AVAILABLE', 'SILENT OBSERVATORY | RESTRICTED']),
      );
    },
  );

  const annexRecord = content.bbs.find((record) => record.id === 'maintenance-annex')!;
  if (annexRecord.kind !== 'message-board') throw new Error('Expected the Annex board');
  const reconstruction = annexRecord.reconstructionCheck!;

  async function replayReady({
    omitFlag,
    omitRead,
    records = content,
  }: { omitFlag?: string; omitRead?: string; records?: Content } = {}) {
    const prior = start(false, false);
    prior.data.flags.push(...[restoreFlag, manifestFlag].filter((flag) => flag !== omitFlag));
    prior.data.bbsReadMessages.push(
      ...reconstruction.fragmentMessageIds
        .filter((id) => id !== omitRead)
        .map((id) => `message:${id}`),
    );
    prior.persist();
    const session = await liveSession(prior, records);
    await openAnnex(session);
    return session;
  }

  it.each([restoreFlag, manifestFlag])('cannot reconstruct without %s', async (omitFlag) => {
    const session = await replayReady({ omitFlag });
    expect(session.commands()).not.toContain('COMPARE');
    await session.noWrite('COMPARE');
    await session.noWrite(canonicalMode);
    await expectUnpublished(session);
  });

  it.each(reconstruction.fragmentMessageIds)(
    'cannot compare before reading %s',
    async (omitRead) => {
      const session = await replayReady({ omitRead });
      expect(session.commands()).not.toContain('COMPARE');
      expect(await session.noWrite('COMPARE')).toContain(reconstruction.copy.missingFragments);
      expect(await session.noWrite(canonicalMode)).toContain(reconstruction.copy.missingFragments);
    },
  );

  it('keeps the comparison and progress intact on invalid choices or a refused write', async () => {
    const session = await replayReady();
    const { noWrite, storage, data } = session;
    await noWrite('COMPARE');
    for (const { operation, evidenceMode, feedback } of reconstruction.choices.slice(1)) {
      expect(await noWrite(`RECONSTRUCT ${operation} / ${evidenceMode}`)).toContain(feedback);
    }
    for (const command of [
      'RECONSTRUCT',
      'RECONSTRUCT REPLAY PRESERVE',
      'RECONSTRUCT REPLAY / PRESERVE / RESET',
      'RECONSTRUCT REPLAY / PRESERVE extra',
      'RECONSTRUCT RESET /',
    ]) {
      expect(await noWrite(command)).toContain(reconstruction.copy.chooseMode);
    }
    const before = structuredClone(data);
    const bytes = storage.value;
    storage.setItem.mockImplementationOnce(() => {
      throw new Error('save refused');
    });
    const refused = (await session.dispatch(canonicalMode)).result;
    expect(refused.completion).toBeUndefined();
    expect(lines(refused)).toEqual([reconstruction.copy.saveRefused]);
    expect(data).toEqual(before);
    expect(storage.value).toBe(bytes);
    expect(session.commands()).toContain(canonicalMode);
    storage.setItem.mockClear();
    expect(
      (await session.dispatch('  reconstruct  replay/preserve  ')).result.completion,
    ).toBeDefined();
    expect(storage.setItem).toHaveBeenCalledOnce();
    expect(sessionData(storage).data.episodes).toEqual(['episode.000', 'episode.002']);
    expect(await noWrite(canonicalMode)).toContain('LOCAL REPLAY AUDIT');
  });

  it('does not complete Chapter 2 on an Episode 000 puzzle solve without the receipt', () => {
    const { data, persist } = start(false, false);
    data.flags.push(restoreFlag, manifestFlag);
    const game = createGame({ content, data, persist });
    expect(game.attempt('puzzle.service', { kind: 'code', code: '709' })).toMatchObject({
      status: 'solved',
      granted: ['solved:puzzle.service', 'flag:service-panel-open'],
    });
    expect(data.episodes).toEqual(['episode.000']);
    expect(data.events.bulletins).not.toContain(unassigned);
  });

  it.each(['seal', 'boundary', 'dependencies', 'recipe', 'dispatch'] as const)(
    'rejects inconsistent %s evidence without committing progress',
    async (field) => {
      const records = structuredClone(content);
      const session = await replayReady({ records });
      expect((await session.noWrite('COMPARE')).join(' ')).toContain(
        reconstruction.copy.comparisonHeading,
      );
      const fragment = session.bbs;
      const queue = records.bbs.find((record) => record.id === 'annex-queue-reader');
      const packet = records.bbs.find((record) => record.id === 'packet-p17');
      const board = records.bbs.find((record) => record.id === 'maintenance-annex');
      if (
        queue?.kind !== 'message' ||
        packet?.kind !== 'message' ||
        board?.kind !== 'message-board'
      ) {
        throw new Error('Expected reconstruction records');
      }
      switch (field) {
        case 'seal':
          queue.retainedModule!.seal = 'BAD';
          break;
        case 'boundary':
          queue.retainedModule!.boundary = 'partial';
          break;
        case 'dependencies':
          queue.retainedModule!.dependencies.push('RW-1');
          break;
        case 'recipe':
          board.reconstructionCheck!.recipe.reverse();
          break;
        case 'dispatch':
          packet.dispatchCopy!.seal = 'BAD';
          break;
      }
      expect(await session.noWrite(canonicalMode)).toContain(reconstruction.copy.mismatch);
      expect(fragment.screen().phase).toBe('board');
      await expectUnpublished(session);
    },
  );

  it.each(Object.values(desk))(
    'exposes only navigation and evidence actions on $board',
    (route) => {
      const journey = start();
      expect(noWrite(journey, 'SUBMIT DEFERRED')).toContain('COMMAND UNAVAILABLE HERE.');
      discover(journey);
      openBoard(journey, route.board);
      const commands = journey.commands();
      expect(commands.filter((command) => !command.startsWith('THREAD '))).toEqual([
        'BACK',
        'MENU',
        'HELP',
        'DISCONNECT',
      ]);
      expect(commands.filter((command) => command.startsWith('THREAD '))).toHaveLength(
        route === desk.headers ? 2 : 3,
      );
      const help = noWrite(journey, 'HELP').join(' ');
      expect(help).toContain('Type SUBMIT <finding>');
      expect(help).not.toContain('DEFERRED');
      for (const candidate of [
        'SUBMIT DEFERRED',
        'SUBMIT NEW',
        'SUBMIT IMPERSONATED',
        'SUBMIT',
        'SUBMIT DEFERRED NOW',
      ]) {
        expect(noWrite(journey, candidate)).toContain(route.rejection);
      }
      for (const command of ['BACK', 'MENU', 'DISCONNECT']) {
        journey.run(command);
        expect(journey.data.bbsReadMessages).toEqual(
          expect.arrayContaining(['message:q17-batch-located']),
        );
        expect(journey.data.flags).not.toContain('deferred-verified');
        expect(journey.data.events.bulletins).toEqual(['q17-batch-located']);
        if (command === 'DISCONNECT') runAll(journey.run, 'CONNECT', 'DESIGNATION');
        openBoard(journey, route.board);
      }

      const [board, thread] = route.evidence[1];
      readThread(journey, board, thread);
      expect(noWrite(journey, 'SUBMIT DEFERRED')).toContain(route.rejection);
    },
  );

  it.each(
    Object.values(desk).flatMap((route) =>
      route.evidence.map((evidence) => ({ route, evidence, missing: evidence[1] })),
    ),
  )('requires $missing before $route.title', ({ route, evidence, missing }) => {
    const journey = start();
    discover(journey);
    gather(journey, route, missing);
    expect(noWrite(journey, 'SUBMIT DEFERRED')).toContain(route.rejection);
    const [board, thread] = evidence;
    readThread(journey, board, thread);
    if (board !== route.board) openBoard(journey, route.board);
    submit(journey, route);
  });

  it.each([
    { first: desk.headers, second: desk.custody },
    { first: desk.custody, second: desk.headers },
  ])('retains $first.title when $second.title is filed after reopening', ({ first, second }) => {
    const journey = start();
    discover(journey);
    gather(journey, first);
    submit(journey, first);
    expect(journey.data.flags).not.toContain(second.flag);
    expect(journey.data.events.bulletins).toEqual(['q17-batch-located', first.resultId]);

    const next = reopen(journey);
    openBoard(next, second.board);
    expect(noWrite(next, 'SUBMIT DEFERRED')).toContain(second.rejection);
    gather(next, second);
    submit(next, second);

    const restored = reopen(next);
    expect(lines(readConfirmation(restored, first))).toContain(first.confirmation);
    expect(lines(readConfirmation(restored, second))).toContain(second.confirmation);
    expect(
      JSON.parse(restored.storage.value!).flags.filter(
        (flag: string) => flag === 'deferred-verified',
      ),
    ).toEqual(['deferred-verified']);
    expect(restored.data.events).toEqual({
      fired: ['q17-batch-located', first.resultId, second.resultId],
      bulletins: ['q17-batch-located', first.resultId, second.resultId],
    });
    expect(voices(restored)).toEqual({
      echo: 'ECHO: The headers place composition before departure. The custody audit confirms the same copies came out of the hold. Both records stay on file.',
      sysop: 'HEADER PROOF AND CUSTODY AUDIT FILED. ORIGINALS REMAIN READ-ONLY.',
    });
    archivedVoices(restored);
    expectHandoffBoundary(restored);
  });
});
