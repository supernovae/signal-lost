import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createBbs, getBbsOffer, type DispatchResult } from '../../src/bbs/bbs.ts';
import { applyBbsEffect } from '../../src/bbs/progress.ts';
import { readContentDir } from '../../src/content/node.ts';
import type { Content } from '../../src/content/schema.ts';
import { loadContent } from '../../src/content/validate.ts';
import { createBbsDoorSession } from '../../src/bbs/door-session.ts';
import { createDoorHost } from '../../src/doors/host.ts';
import { createDoorRegistry } from '../../src/doors/registry.ts';
import { factsOf, openSaveSession } from '../../src/progress/save.ts';
import discoveryFixture from '../fixtures/bbs-discovery.json';

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
  const bbs = createBbs(offer(records), () => data, {
    list: () => registry.list(factsOf(data)),
    facts: liveFacts ?? (() => factsOf(data)),
  });
  function run(command: string) {
    const result = bbs.dispatch(command);
    if (result.effect) {
      applyBbsEffect(data, result.effect);
      persist();
    }
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
    expect(lines(run('designation'))).toContain('SIGNED IN AS OBS-02FF');
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
      { tone: 'sysop', origin: 'fictional', lines: offer().board.sysopGreeting },
    ]);
    data.flags.push('relay-trivia-complete');
    expect(lines(run('MENU'))).toContain('RELAY DRILL: COMPLETE');
    expect(lines(run('DISCONNECT'))).toEqual(['DISCONNECTED']);
    expect(bbs.screen().phase).toBe('offline');
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
  const { run, commands, data } = boardSession(sessionData(), records);
  runAll(run, 'CONNECT', 'DESIGNATION', 'BOARDS');
  expect(commands().slice(0, 2)).toEqual(['BOARD general', 'BOARD second-line']);
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
  expect(lines(run('BOARD second-line'))).toContain('NO THREADS AVAILABLE.');
  expect(commands()).not.toContain('THREAD second-line-thread');
  expect(run('THREAD second-line-thread').effect).toBeUndefined();
  data.flags.push('service-panel-open');
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
