import { describe, expect, it, vi } from 'vitest';
import deepField from '../../../content/bbs/deep-field.json';
import { getBbsOffer } from '../../../src/bbs/bbs.ts';
import { createBbsDoorSession } from '../../../src/bbs/door-session.ts';
import { bbsBoardSchema } from '../../../src/content/schema.ts';
import { CODE_DOORS } from '../../../src/doors/code-doors.ts';
import type { DoorProgress, DoorScreen } from '../../../src/doors/contract.ts';
import { createDoorHost } from '../../../src/doors/host.ts';
import { createDoorRegistry } from '../../../src/doors/registry.ts';
import { generateScenario, type Difficulty } from '../../../src/doors/signal-hunter/scenario.ts';
import { createSignalHunterDoor } from '../../../src/doors/signal-hunter/signal-hunter.ts';
import {
  factsOf,
  freshSave,
  openSaveSession,
  writeSave,
  type SaveData,
  type SaveStorage,
} from '../../../src/progress/save.ts';
import { emptyContent } from '../helpers.ts';

const hunter = 'signal-hunter';
const manifestFlag = 'manifest-r07-spool-02';
const manifestFact = `flag:${manifestFlag}`;
const openHunter = `OPEN ${hunter}`;
const solved = 'ROUND SOLVED.';
const manifestLines = [
  'SIGNED REPAIR MANIFEST R07-SPOOL-02',
  'TARGET: SPOOL-02 | SIGNATURE: VERIFIED',
  'SC-1 / signature-checker | REQUIRES: none',
  'QR-1 / queue-reader | REQUIRES: SC-1',
  'RW-1 / replay-writer | REQUIRES: QR-1 and SC-1',
  'BUILD ORDER: SC-1 → QR-1 → RW-1',
  'These three complete modules are sufficient for the local repair.',
  'DESTINATION: separate replay copy. Preserve sealed originals unchanged.',
];
const storyCards = [
  'H1 | RELAY-07 / INTACT | Relay-only index.',
  'H2 | SPOOL-02 / DAMAGED | Spool trace with a failed seal.',
  'H3 | SPOOL-02 / INTACT | Spool trace with a readable seal.',
];
const tiers: Record<Difficulty, { domain: string[]; feedback: RegExp; rule: RegExp }> = {
  interference: {
    domain: ['A', 'B', 'C', 'D'],
    feedback: /^Lane [A-D], sample [1-4] has a residual of [0-4]\./,
    rule: /Subtract reference from receiver.*at least 5 in all four samples\./,
  },
  periodicity: {
    domain: ['3', '4', '5', '6'],
    feedback: /^At tick \d+, the trace shows (a pulse but .* a gap|a gap but .* a pulse)\./,
    rule: /5 or higher marks a pulse.*predicts every pulse and gap\./,
  },
  'hidden-pattern': {
    domain: ['1', '2', '3', '4'],
    feedback: /^Slot [1-4], frame [12] reads [01]{4}\. The reference word is [01]{4}\./,
    rule: /four bits exactly match the reference word in both frames\./,
  },
};
const difficulties = Object.keys(tiers) as Difficulty[];
const progress: DoorProgress = { hasFact: () => false };
const traderProgress: DoorProgress = { hasFact: (fact) => fact === manifestFact };
const boardContent = { ...emptyContent(), bbs: [bbsBoardSchema.parse(deepField)] };
const hunterRegistration = CODE_DOORS.find(({ metadata }) => metadata.id === hunter)!;

function begin(seed: number, difficulty: Difficulty) {
  const running = createSignalHunterDoor(seed).launch(progress);
  running.input('PRACTICE', progress);
  const screen = running.input(difficulty.toUpperCase(), progress);
  return { running, screen };
}

function lanePairs(lines: readonly string[]) {
  const lanes = lines.filter((line) => /^Lane [A-D]:/.test(line));
  expect(lanes.map((line) => line[5])).toEqual(['A', 'B', 'C', 'D']);
  return lanes.map((line) => {
    const pairs = [...line.matchAll(/(\d+)\/(\d+)/g)].map((match) => match.slice(1).map(Number));
    expect(pairs).toHaveLength(4);
    return { lane: line[5]!, pairs };
  });
}

/** Solve the printed trace without access to either the generator or judge. */
function visibleSolutions(difficulty: Difficulty, lines: readonly string[]): string[] {
  switch (difficulty) {
    case 'interference': {
      const lanes = lanePairs(lines);
      const candidates = lanes
        .filter(({ pairs }) => pairs.every(([receiver, reference]) => receiver! - reference! >= 5))
        .map(({ lane }) => lane);
      const largestPeak = lanes.reduce((highest, lane) =>
        Math.max(...highest.pairs.map(([receiver]) => receiver!)) >
        Math.max(...lane.pairs.map(([receiver]) => receiver!))
          ? highest
          : lane,
      );
      expect(candidates).not.toContain(largestPeak.lane);
      return candidates;
    }
    case 'periodicity': {
      const trace = [...lines.join('\n').matchAll(/\b(\d+)=(\d+)\b/g)];
      expect(trace.map(([, tick]) => Number(tick))).toEqual(
        Array.from({ length: 24 }, (_, i) => i),
      );
      const pulseTicks = trace
        .filter(([, , level]) => Number(level) >= 5)
        .map(([, tick]) => Number(tick));
      expect(pulseTicks[0]).toBe(0);
      return ['3', '4', '5', '6'].filter((period) =>
        trace.every(
          ([, tick]) => pulseTicks.includes(Number(tick)) === (Number(tick) % Number(period) === 0),
        ),
      );
    }
    case 'hidden-pattern': {
      const reference = lines.find((line) => /^Reference word: [01]{4}$/.test(line))?.slice(-4);
      expect(reference).toBeDefined();
      const frames = lines
        .filter((line) => /^Frame [12]:/.test(line))
        .map((frame) => [...frame.matchAll(/([1-4])=([01]{4})/g)]);
      expect(frames).toHaveLength(2);
      for (const frame of frames)
        expect(frame.map(([, slot]) => slot)).toEqual(['1', '2', '3', '4']);
      const matches = frames.map((frame) =>
        frame.filter(([, , word]) => word === reference).map(([, slot]) => slot!),
      );
      expect(matches.map((frame) => frame.length)).toEqual([2, 2]);
      return matches[0]!.filter((slot) => matches[1]!.includes(slot));
    }
  }
}

function submissions(screen: DoorScreen): string[] {
  return screen.actions
    .map(({ command }) => command)
    .filter((command) => command.startsWith('SUBMIT '));
}

function seedBoard(seed = 42, restored = true, traderFirst = false) {
  let value: string | null = null;
  const storage: SaveStorage = {
    getItem: () => value,
    setItem: (_key, text) => {
      value = text;
    },
    removeItem: () => {
      value = null;
    },
  };
  const data = freshSave(seed);
  data.episodes.push('episode.000');
  data.profile.designation = 'OBS-02FF';
  data.flags.push('deferred-verified', 'spool-02-order-learned');
  if (restored) data.flags.push('spool-02-restored');
  if (traderFirst) data.flags.push(manifestFlag);
  data.doorState['other-door'] = { version: 2, payload: 'preserve me' };
  writeSave(storage, data);
  return { storage, data };
}

async function openBoard(storage: SaveStorage) {
  const { data, persist, status } = openSaveSession(storage, () => 0xabcdef);
  expect(status).toBe('loaded');
  const settle = vi.fn<(candidate: SaveData) => void>();
  const host = createDoorHost(createDoorRegistry([], [hunterRegistration]), data, persist, settle);
  const bbs = createBbsDoorSession(getBbsOffer(boardContent, factsOf(data))!, () => data, host);
  async function run(command: string) {
    return (await bbs.dispatch(command))!.output.flatMap(({ lines }) => lines);
  }
  const commands = () => bbs.screen().actions.map(({ command }) => command);
  await run('CONNECT');
  expect(await run('DESIGNATION')).toContain('SIGNED IN AS OBS-02FF');
  await run('DOORS');
  return { commands, data, run, settle };
}

function emptyRound(ordinal = 0) {
  return { ordinal, solved: false, everSolved: false };
}

function checkpoint(ordinal = 0, hunterVerified = false) {
  return {
    hunterVerified,
    lastTier: 'interference',
    tiers: {
      interference: emptyRound(ordinal),
      periodicity: emptyRound(),
      'hidden-pattern': emptyRound(),
    },
  };
}

describe('Signal Hunter practice', () => {
  it.each(difficulties)(
    'generates deterministic %s evidence from the seed and ordinal',
    (difficulty) => {
      const seeds = [0, 42, 198, 0xffffffff];
      for (const seed of seeds) {
        for (const round of [0, 1, 17, 0xffffffff]) {
          expect(generateScenario(seed, difficulty, round)).toEqual(
            generateScenario(seed, difficulty, round),
          );
        }
      }
      expect(
        new Set(seeds.map((seed) => JSON.stringify(generateScenario(seed, difficulty, 0)))).size,
      ).toBe(seeds.length);
      expect(generateScenario(0xffffffff, difficulty, 0x100000000)).toEqual(
        generateScenario(0xffffffff, difficulty, 0),
      );
    },
  );

  it.each(difficulties)(
    'has exactly one publicly solvable %s answer for 200 seeds and at later rounds',
    (difficulty) => {
      const { domain, rule } = tiers[difficulty];
      for (const [seed, ordinal] of [
        ...Array.from({ length: 200 }, (_, seed) => [seed, 0] as const),
        [42, 1],
        [42, 17],
        [0xffffffff, 0],
        [0xffffffff, 0xffffffff],
      ] as const) {
        const saved = { ...checkpoint(), lastTier: difficulty };
        saved.tiers[difficulty].ordinal = ordinal;
        const running = createSignalHunterDoor(seed).restore(saved, progress)!;
        const screen = running.input('RESUME PRACTICE', progress);
        expect(screen.lines.join('\n')).toMatch(rule);
        const expected = visibleSolutions(difficulty, screen.lines);
        expect(expected).toHaveLength(1);
        const legal = submissions(screen);
        expect(legal).toEqual(domain.map((choice) => `SUBMIT ${choice}`));
        // Reopen the same unsolved round for each answer so a correct attempt cannot mask a later wrong one.
        const successes = legal.filter((command) => {
          const trial = createSignalHunterDoor(seed).restore(saved, progress)!;
          trial.input('RESUME PRACTICE', progress);
          return trial.input(command, progress).lines.includes(solved);
        });
        expect(successes).toEqual([`SUBMIT ${expected[0]}`]);
      }
    },
  );

  it.each(difficulties)(
    'explains a wrong %s answer and supports retry, reread and new rounds',
    (difficulty) => {
      const { running, screen } = begin(42, difficulty);
      const atStart = running.checkpoint(progress).payload;
      const [right] = visibleSolutions(difficulty, screen.lines);
      const wrong = tiers[difficulty].domain.find((choice) => choice !== right)!;
      const response = running.input(`  sUbMiT  ${wrong.toLowerCase()}  `, progress);
      expect(response.lines.at(-1)).toMatch(tiers[difficulty].feedback);
      expect(running.checkpoint(progress).payload).toEqual(atStart);

      for (const command of ['SUBMIT', 'SUBMIT 99', `SUBMIT ${right} EXTRA`, '???']) {
        const result = running.input(command, progress);
        expect(result.lines).toContainEqual(expect.stringMatching(/^Use a listed SUBMIT command/));
        expect(result.lines).not.toContain(solved);
      }
      for (const command of ['RETRY', 'TRACE']) {
        expect(screen.actions).toContainEqual(expect.objectContaining({ command }));
        expect(running.input(command, progress)).toEqual(screen);
      }
      expect(running.input(` \tSuBmIt \t${right!.toLowerCase()}  `, progress).lines).toContain(
        solved,
      );
      const next = running.input('NEW', progress);
      expect(next.lines[0]).toMatch(/ROUND 2$/);
      expect(next.lines.slice(1)).not.toEqual(screen.lines.slice(1));
      expect(next.lines).not.toContain(solved);
      expect(visibleSolutions(difficulty, next.lines)).not.toEqual([right]);

      const menu = running.input('PRACTICE', progress);
      expect(menu.actions.map(({ command }) => command)).toEqual([
        'INTERFERENCE',
        'PERIODICITY',
        'HIDDEN-PATTERN',
        'STORY',
      ]);
      expect(running.input('UNKNOWN', progress).lines).toContain(
        'Choose INTERFERENCE, PERIODICITY or HIDDEN-PATTERN.',
      );
      for (const { command } of menu.actions) {
        running.input('PRACTICE', progress);
        const result = running.input(command, progress);
        expect(result.lines).not.toContain('Choose INTERFERENCE, PERIODICITY or HIDDEN-PATTERN.');
      }
      expect(running.input('RESUME PRACTICE', progress).lines[0]).toMatch(
        /HIDDEN PATTERN \| ROUND/,
      );
    },
  );

  it('pins seed 42 to lane C and changes the answer order across practice blocks', () => {
    const { running, screen } = begin(42, 'interference');
    expect(visibleSolutions('interference', screen.lines)).toEqual(['C']);
    const answers = ['C'];
    for (let i = 1; i < 12; i++) {
      const next = running.input('NEW', progress);
      answers.push(visibleSolutions('interference', next.lines)[0]!);
    }
    for (let first = 0; first < answers.length; first += 4) {
      expect(new Set(answers.slice(first, first + 4))).toEqual(new Set(['A', 'B', 'C', 'D']));
    }
    expect(answers.slice(0, 4)).not.toEqual(['C', 'D', 'A', 'B']);
    expect(answers.slice(0, 4)).not.toEqual(answers.slice(4, 8));

    const wrapping = createSignalHunterDoor(42).restore(checkpoint(0xffffffff), progress)!;
    const last = wrapping.input('RESUME PRACTICE', progress);
    expect(last.lines[0]).toBe('INTERFERENCE | ROUND 4294967296');
    expect(visibleSolutions('interference', last.lines)).not.toEqual(['C']);
    expect(wrapping.input('NEW', progress)).toEqual(screen);
  });
});

describe('Signal Hunter in the shipped BBS', () => {
  it('refuses the door before recovery even when proof and training are present', async () => {
    const { storage } = seedBoard(42, false);
    const board = await openBoard(storage);
    expect(board.commands()).not.toContain(openHunter);
    expect(await board.run(openHunter)).toContain('DOOR UNAVAILABLE.');
    expect(board.data.doorState).not.toHaveProperty(hunter);
    expect(board.settle).not.toHaveBeenCalled();
  });

  it.each([
    ['H1', 'H1 rejected. This trace is from RELAY-07. The request requires SPOOL-02.'],
    ['H2', 'H2 rejected. Its damaged signature cannot be verified.'],
  ])(
    'rejects %s and awards the manifest only for H3 without practice or Trader',
    async (card, rejection) => {
      const { storage } = seedBoard();
      const board = await openBoard(storage);
      expect(board.commands()).toContain(openHunter);
      const story = await board.run(openHunter);
      expect(story).toEqual(expect.arrayContaining(storyCards));
      expect(story).toContain(
        'TARGET MANIFEST R07-SPOOL-02. Verify a trace from SPOOL-02 with an intact signature.',
      );
      expect(board.commands()).toEqual(['VERIFY H1', 'VERIFY H2', 'VERIFY H3', 'PRACTICE', 'EXIT']);
      expect(await board.run('MANIFEST')).toContain(
        'The manifest is still sealed. Verify a trace that meets both requirements.',
      );
      expect(await board.run(`VERIFY ${card}`)).toContain(rejection);
      expect(factsOf(board.data).has(manifestFact)).toBe(false);
      expect(board.settle).not.toHaveBeenCalled();

      const direct = createSignalHunterDoor(42).launch(progress);
      direct.input(`VERIFY ${card}`, progress);
      expect(direct.checkpoint(progress).earnedRewards).toEqual([]);
      direct.input('  vErIfY  h3 ', progress);
      expect(direct.checkpoint(progress).earnedRewards).toEqual([manifestFact]);

      expect(await board.run('VERIFY H3')).toEqual(expect.arrayContaining(manifestLines));
      expect(board.commands()).toContain('MANIFEST');
      expect(factsOf(board.data).has(manifestFact)).toBe(true);
      expect(board.data.doorState).not.toHaveProperty('relay-trader');
      expect(board.data.doorState[hunter]).toMatchObject({
        version: 1,
        payload: { hunterVerified: true, lastTier: null },
      });
      expect(board.settle).toHaveBeenCalledOnce();
      expect(await board.run('EXIT')).toContain('DEEP FIELD MAIN MENU');
      await board.run('DOORS');
      await board.run(openHunter);
      expect(await board.run('MANIFEST')).toEqual(expect.arrayContaining(manifestLines));
      expect(await board.run('VERIFY H3')).toEqual(expect.arrayContaining(manifestLines));
      expect(board.data.flags.filter((flag) => flag === manifestFlag)).toEqual([manifestFlag]);
      expect(board.settle).toHaveBeenCalledOnce();
    },
  );

  it('displays the same signed artifact from a Trader-first save without proposing another reward', async () => {
    const { storage, data } = seedBoard(42, true, true);
    expect(data.doorState).not.toHaveProperty(hunter);
    const board = await openBoard(storage);
    await board.run(openHunter);
    expect(board.commands()).toContain('MANIFEST');
    const direct = createSignalHunterDoor(42).launch(traderProgress);
    for (const command of ['MANIFEST', 'VERIFY H3']) {
      expect(await board.run(command)).toEqual(expect.arrayContaining(manifestLines));
      expect(direct.input(command, traderProgress).lines).toEqual(
        expect.arrayContaining(manifestLines),
      );
      expect(direct.checkpoint(traderProgress).earnedRewards).toEqual([]);
    }
    expect(board.data.doorState[hunter]).toMatchObject({ payload: { hunterVerified: false } });
    expect(board.data.flags.filter((flag) => flag === manifestFlag)).toEqual([manifestFlag]);
    expect(board.settle).not.toHaveBeenCalled();
  });

  it('persists independent round ordinals and completions across a serialized reload', async () => {
    const { storage, data } = seedBoard();
    const board = await openBoard(storage);
    await board.run(openHunter);
    const beforePractice = factsOf(board.data);
    await board.run('PRACTICE');
    const first = await board.run('INTERFERENCE');
    expect(await board.run('SUBMIT C')).toContain(solved);
    expect(factsOf(board.data)).toEqual(beforePractice);
    expect(board.settle).not.toHaveBeenCalled();

    await board.run('STORY');
    await board.run('VERIFY H3');
    await board.run('RESUME PRACTICE');
    const seen = new Set([JSON.stringify(lanePairs(first))]);
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      const round = await board.run('NEW');
      expect(round).toContain(`INTERFERENCE | ROUND ${ordinal + 1}`);
      expect(round).not.toContain(solved);
      seen.add(JSON.stringify(lanePairs(round)));
    }
    expect(seen.size).toBe(4);
    const fourth = await board.run('TRACE');
    const [answer] = visibleSolutions('interference', fourth);
    expect(await board.run(`SUBMIT ${answer}`)).toContain(solved);
    const solvedBytes = storage.getItem('');
    expect(await board.run(`SUBMIT ${answer}`)).toContain(solved);
    expect(storage.getItem('')).toBe(solvedBytes);
    const fifth = await board.run('NEW');
    expect(fifth).not.toContain(solved);
    expect(await board.run('PRACTICE')).toContain('Interference: COMPLETED (INTERFERENCE)');
    await board.run('PERIODICITY');
    const periodRound = await board.run('NEW');
    const [period] = visibleSolutions('periodicity', periodRound);
    const solvedPeriod = await board.run(`SUBMIT ${period}`);
    expect(solvedPeriod).toContain(solved);
    expect(await board.run('EXIT')).toContain('DEEP FIELD MAIN MENU');

    const next = await openBoard(storage);
    await next.run(openHunter);
    expect(next.commands()).toContain('RESUME PRACTICE');
    expect(await next.run('RESUME PRACTICE')).toEqual(solvedPeriod);
    expect(await next.run('PRACTICE')).toEqual(
      expect.arrayContaining([
        'Interference: COMPLETED (INTERFERENCE)',
        'Periodicity: COMPLETED (PERIODICITY)',
        'Hidden Pattern: OPEN (HIDDEN-PATTERN)',
      ]),
    );
    expect(await next.run('INTERFERENCE')).toEqual(fifth);
    expect(next.data.profile.seed).toBe(42);
    expect(next.data.doorState['other-door']).toEqual(data.doorState['other-door']);
    expect(next.data.doorState[hunter]).toMatchObject({
      version: 1,
      payload: {
        hunterVerified: true,
        lastTier: 'interference',
        tiers: {
          interference: { ordinal: 4, solved: false, everSolved: true },
          periodicity: { ordinal: 1, solved: true, everSolved: true },
          'hidden-pattern': emptyRound(),
        },
      },
    });
    expect(next.data.flags.filter((flag) => flag === manifestFlag)).toEqual([manifestFlag]);
    expect(board.settle).toHaveBeenCalledOnce();
    expect(next.settle).not.toHaveBeenCalled();

    const otherSeed = await openBoard(seedBoard(43).storage);
    await otherSeed.run(openHunter);
    await otherSeed.run('PRACTICE');
    expect(lanePairs(await otherSeed.run('INTERFERENCE'))).not.toEqual(lanePairs(first));
  });

  it.each(['missing', 'version', 'payload'] as const)(
    'starts fresh with a %s Hunter slot and preserves global access',
    async (kind) => {
      const { storage, data } = seedBoard(42, true, true);
      if (kind === 'version') data.doorState[hunter] = { version: 2, payload: checkpoint(14) };
      if (kind === 'payload') data.doorState[hunter] = { version: 1, payload: checkpoint(-1) };
      writeSave(storage, data);
      const board = await openBoard(storage);
      await board.run(openHunter);
      expect(board.commands()).not.toContain('RESUME PRACTICE');
      expect(await board.run('MANIFEST')).toEqual(expect.arrayContaining(manifestLines));
      await board.run('PRACTICE');
      expect(await board.run('INTERFERENCE')).toContain('INTERFERENCE | ROUND 1');
      expect(board.data.doorState['other-door']).toEqual(data.doorState['other-door']);
      expect(board.settle).not.toHaveBeenCalled();
    },
  );

  it('clears a stale verification latch without awarding the manifest on a practice action', async () => {
    const { storage, data } = seedBoard();
    data.doorState[hunter] = { version: 1, payload: checkpoint(12, true) };
    writeSave(storage, data);
    const board = await openBoard(storage);
    await board.run(openHunter);
    expect(board.commands()).not.toContain('MANIFEST');
    expect(await board.run('RESUME PRACTICE')).toContain('INTERFERENCE | ROUND 13');
    expect(board.data.doorState[hunter]).toMatchObject({ payload: { hunterVerified: false } });
    expect(factsOf(board.data).has(manifestFact)).toBe(false);
    expect(board.settle).not.toHaveBeenCalled();
    await board.run('STORY');
    expect(await board.run('VERIFY H3')).toEqual(expect.arrayContaining(manifestLines));
    expect(board.settle).toHaveBeenCalledOnce();
  });
});
