import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBbs, getBbsOffer } from '../../src/bbs/bbs.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';

const contentDir = resolve('content');
const completed = new Set(['completed:episode.000']);
const { content } = loadContent(readContentDir(contentDir));
const offer = getBbsOffer(content, completed)!;
const identity = { designation: 'OBS-02FF', handle: null, readMessages: [] };
const banner = [
  'OBSERVER NETWORK RELAY 07',
  'SYSTEM STATUS: DEGRADED',
  'ACTIVE CONNECTIONS: UNKNOWN',
  'INCOMING CONNECTION ACCEPTED',
  'WELCOME TO THE ECHO NETWORK',
];

describe('the DEEP FIELD session', () => {
  it('connects, uses the designation, reads the farewell, visits SYSOP and disconnects', () => {
    const bbs = createBbs(offer, { ...identity, handle: 'SavedHandle' });
    expect(bbs.screen().phase).toBe('offline');
    expect(bbs.dispatch('connect')).toEqual({ output: { tone: 'system', lines: banner } });
    expect(bbs.screen().actions.map(({ command }) => command)).toEqual([
      'DESIGNATION',
      'LOGIN',
      'HELP',
      'DISCONNECT',
    ]);
    expect(bbs.screen().hint).toContain('LOGIN <HANDLE>');
    const signIn = bbs.dispatch('designation');
    expect(signIn.output.lines).toContain('SIGNED IN AS OBS-02FF');
    expect(signIn.effect).toBeUndefined();
    expect(bbs.screen().phase).toBe('menu');
    expect(bbs.screen().actions.map(({ command }) => command)).toEqual([
      'MESSAGES',
      'SYSOP',
      'HELP',
      'DISCONNECT',
    ]);
    expect(bbs.dispatch('MESSAGES').effect).toBeUndefined();
    expect(bbs.screen().hint).toContain('READ <NUMBER>');
    expect(bbs.screen().actions[0]).toEqual({ command: 'READ 1', label: 'LAST ONE OUT [UNREAD]' });
    const farewell = content.archives.find((archive) => archive.id === 'lore.last-sysop')!;
    expect(bbs.dispatch('read 1')).toEqual({
      output: {
        tone: 'history',
        lines: ['LAST ONE OUT', 'FROM: TKEEL', 'DATE: 2001-03-01', ...farewell.body],
      },
      effect: { readKey: 'archive:lore.last-sysop' },
    });
    expect(bbs.screen().phase).toBe('message');
    bbs.dispatch('MENU');
    expect(bbs.screen().phase).toBe('menu');
    expect(bbs.dispatch('SYSOP')).toEqual({
      output: { tone: 'sysop', lines: offer.board.sysopGreeting },
    });
    expect(bbs.screen().phase).toBe('sysop');
    bbs.dispatch('MENU');
    expect(bbs.screen().phase).toBe('menu');
    expect(bbs.dispatch('DISCONNECT').output.lines).toEqual(['DISCONNECTED']);
    expect(bbs.screen().phase).toBe('offline');
    expect(bbs.dispatch('CONNECT').output.lines).toEqual(banner);
  });

  it('uses a normalized custom handle and emits each changed effect once', () => {
    const bbs = createBbs(offer, { ...identity, designation: null });
    bbs.dispatch('CONNECT');
    expect(bbs.screen().actions.map(({ command }) => command)).not.toContain('DESIGNATION');
    const login = bbs.dispatch('  lOgIn   Relay  Finch   ');
    expect(login.output.lines).toContain('SIGNED IN AS Relay  Finch');
    expect(login.effect).toEqual({ handle: 'Relay  Finch' });
    bbs.dispatch('MESSAGES');
    expect(bbs.dispatch('READ 1').effect).toEqual({ readKey: 'archive:lore.last-sysop' });
    bbs.dispatch('MENU');
    bbs.dispatch('MESSAGES');
    expect(bbs.screen().actions[0]?.label).toBe('LAST ONE OUT [READ]');
    expect(bbs.dispatch('READ 1').effect).toBeUndefined();

    const reconnected = createBbs(offer, {
      ...identity,
      handle: 'Relay  Finch',
      readMessages: ['archive:lore.last-sysop'],
    });
    reconnected.dispatch('CONNECT');
    expect(reconnected.dispatch('LOGIN Relay  Finch').effect).toBeUndefined();
    reconnected.dispatch('MESSAGES');
    expect(reconnected.screen().actions[0]?.label).toBe('LAST ONE OUT [READ]');
    expect(reconnected.dispatch('READ 1').effect).toBeUndefined();
  });

  it('gives contextual help and keeps the current screen and effects on refusal', () => {
    const bbs = createBbs(offer, { ...identity, designation: null });
    expect(bbs.dispatch('MESSAGES').output.lines).toEqual([bbs.screen().hint]);
    expect(bbs.screen().phase).toBe('offline');
    bbs.dispatch('CONNECT');

    const expectHelp = (command: string, feedback?: string) => {
      const { hint, phase } = bbs.screen();
      expect(bbs.dispatch(command)).toEqual({
        output: { tone: 'system', lines: feedback ? [feedback, hint] : [hint] },
      });
      expect(bbs.screen().phase).toBe(phase);
    };

    expectHelp('help');
    expectHelp('DESIGNATION', 'NO OBSERVER DESIGNATION AVAILABLE.');
    expectHelp('LOGIN   ', 'ENTER A FICTIONAL HANDLE.');
    expectHelp('SYSOP', 'COMMAND UNAVAILABLE HERE.');
    bbs.dispatch('LOGIN Finch');
    expectHelp('HELP');
    expectHelp('GARBAGE', 'COMMAND UNAVAILABLE HERE.');
    bbs.dispatch('MESSAGES');
    expectHelp('HELP');
    for (const invalid of ['READ', 'READ two', 'READ 0', 'READ 2', 'READ 1.5', 'READ 1 2']) {
      expectHelp(invalid, 'SELECT A MESSAGE FROM THE LIST.');
    }
    bbs.dispatch('READ 1');
    expectHelp('HELP');
    bbs.dispatch('MENU');
    bbs.dispatch('SYSOP');
    expectHelp('HELP');
    bbs.dispatch('DISCONNECT');
    bbs.dispatch('CONNECT');
    expect(bbs.dispatch('DISCONNECT').effect).toBeUndefined();
    expect(bbs.screen().phase).toBe('offline');
  });

  it('adds a list entry and read command from a standalone JSON message', () => {
    const root = mkdtempSync(join(tmpdir(), 'signal-lost-bbs-'));
    try {
      cpSync(contentDir, root, { recursive: true });
      const before = loadContent(readContentDir(root));
      expect(before.errors).toEqual([]);
      expect(getBbsOffer(before.content, completed)?.messages.map(({ title }) => title)).toEqual([
        'LAST ONE OUT',
      ]);

      const body = 'I left a spare cable beside the relay.';
      writeFileSync(
        join(root, 'bbs', 'spare-cable.json'),
        JSON.stringify({
          kind: 'message',
          id: 'spare-cable',
          board: offer.board.id,
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
      const expanded = getBbsOffer(after.content, completed)!;
      expect(expanded.board).toEqual(offer.board);
      const bbs = createBbs(expanded, identity);
      bbs.dispatch('CONNECT');
      bbs.dispatch('DESIGNATION');
      bbs.dispatch('MESSAGES');
      const readActions = bbs.screen().actions.filter(({ command }) => command.startsWith('READ '));
      expect(readActions).toEqual([
        { command: 'READ 1', label: 'LAST ONE OUT [UNREAD]' },
        { command: 'READ 2', label: 'SPARE CABLE [UNREAD]' },
      ]);
      expect(bbs.dispatch(readActions[1]!.command)).toEqual({
        output: {
          tone: 'history',
          lines: ['SPARE CABLE', 'FROM: FINCH', 'DATE: 2001-03-02', body],
        },
        effect: { readKey: 'message:spare-cable' },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
