import { expect, it } from 'vitest';
import { createBbsProgress } from '../../src/bbs/progress.ts';
import { readContentDir } from '../../src/content/node.ts';
import { loadContent } from '../../src/content/validate.ts';
import { createDialogueSources } from '../../src/narrative/dialogue.ts';
import { settleEvents } from '../../src/progress/events.ts';
import { freshSave } from '../../src/progress/save.ts';
import { createGame } from '../../src/puzzle/game.ts';

const { content } = loadContent(readContentDir('content'));
const voices = createDialogueSources(content.characters);

it('selects distinct authored BBS lines for the same facts before and after a read', () => {
  const data = freshSave(42);
  const game = createGame({ content, data, persist: () => {} });
  const echo = voices.get('echo')!;
  const sysop = voices.get('sysop')!;
  expect(voices.get('unknown')).toBeUndefined();
  const before = game.dialogueState();
  expect(echo.next('bbs', before)).toMatchObject({
    id: 'echo.bbs.greeting',
    text: ['ECHO: The relay desk note is available. I have no receipt for your copy yet.'],
  });
  expect(sysop.next('bbs', before)).toMatchObject({
    id: 'sysop.bbs.greeting',
    text: [
      'Observer. I am the local preservation routine.',
      'Keel left the line open. I kept what the board could carry.',
    ],
  });

  const after = { ...before, facts: new Set(['flag:relay-note-read']) };
  expect(echo.next('bbs', after)).toMatchObject({
    id: 'echo.bbs.relay-receipt',
    text: ['ECHO: The desk logged your read. A receipt tells me where the copy landed.'],
  });
  expect(sysop.next('bbs', after)).toMatchObject({
    id: 'sysop.bbs.relay-receipt',
    text: ['RECEIPT FILED AT RELAY 07. ORIGINAL REMAINS READ-ONLY.'],
  });
});

it('keeps facts, fired events and unlocks independent of the dialogue requested', () => {
  const records = {
    ...content,
    transmissions: [
      ...content.transmissions,
      { id: 'receipt', title: 'Receipt confirmation', body: [], requires: 'flag:relay-note-read' },
    ],
  };
  const runs = [undefined, voices.get('echo'), voices.get('sysop')].map((source) => {
    const data = freshSave(42);
    const game = createGame({ content: records, data, persist: () => {} });
    if (source) game.say(source, 'bbs');
    const progress = createBbsProgress(
      data,
      (candidate) => settleEvents(records.events, candidate),
      () => true,
    );
    progress.apply({
      history: { kind: 'thread', id: 'relay-thread' },
      readKeys: ['message:relay-note'],
    });
    if (source) game.say(source, 'bbs');
    return {
      seen: data.seenLines,
      progress: { facts: game.facts(), events: data.events, unlocks: game.transmissions() },
    };
  });
  expect(runs.map(({ seen }) => seen)).toEqual([
    [],
    ['echo.bbs.greeting', 'echo.bbs.relay-receipt'],
    ['sysop.bbs.greeting', 'sysop.bbs.relay-receipt'],
  ]);
  for (const run of runs) {
    expect(run.progress).toEqual({
      facts: new Set(['bbs-read:relay-note', 'flag:relay-note-read']),
      events: { fired: ['relay-read', 'relay-bulletin'], bulletins: ['relay-bulletin'] },
      unlocks: [records.transmissions.at(-1)],
    });
  }
});
