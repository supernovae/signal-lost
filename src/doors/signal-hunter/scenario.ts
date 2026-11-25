import { mulberry32 } from '../../signal/rng.ts';

export const DIFFICULTIES = ['interference', 'periodicity', 'hidden-pattern'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

const LANES = ['A', 'B', 'C', 'D'] as const;
const PERIODS = [3, 4, 5, 6] as const;
const SLOTS = ['1', '2', '3', '4'] as const;
export const RESIDUAL_MIN = 5;
export const DETECTION_MIN = 5;

export const choices: Record<Difficulty, readonly string[]> = {
  interference: LANES,
  periodicity: PERIODS.map(String),
  'hidden-pattern': SLOTS,
};

const salts: Record<Difficulty, number> = {
  interference: 0,
  periodicity: 0x9e3779b9,
  'hidden-pattern': 0x85ebca6b,
};

export type Scenario =
  | {
      difficulty: 'interference';
      lanes: { lane: string; samples: { receiver: number; reference: number }[] }[];
    }
  | { difficulty: 'periodicity'; ticks: number[] }
  | { difficulty: 'hidden-pattern'; reference: string; slots: { slot: string; words: string[] }[] };

type Submission =
  | { result: 'correct' | 'invalid' }
  | { result: 'interference'; sample: number; residual: number }
  | { result: 'periodicity'; tick: number; observed: boolean; predicted: boolean }
  | { result: 'hidden-pattern'; frame: number; word: string; reference: string };

function chooseTarget(seed: number, round: number): number {
  const first = Math.floor(mulberry32(seed)() * 4);
  const withinBlock = round % 4;
  if (withinBlock === 0) return first;

  // Keep the first choice fixed so adjacent rounds differ across blocks and uint32 wrap.
  const remaining = [0, 1, 2, 3].filter((choice) => choice !== first);
  const random = mulberry32((seed ^ Math.imul(Math.floor(round / 4) + 1, 0x9e3779b9)) >>> 0);
  for (let index = remaining.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [remaining[index], remaining[swap]] = [remaining[swap]!, remaining[index]!];
  }
  return remaining[withinBlock - 1]!;
}

function bits(word: number): string {
  return word.toString(2).padStart(4, '0');
}

export function generateScenario(
  saveSeed: number,
  difficulty: Difficulty,
  round: number,
): Scenario {
  const seed = (saveSeed ^ salts[difficulty]) >>> 0;
  const ordinal = round >>> 0;
  const target = chooseTarget(seed, ordinal);
  const random = mulberry32((seed ^ Math.imul(ordinal + 1, 0x27d4eb2d) ^ 0xc2b2ae35) >>> 0);
  const sample = (max: number) => Math.floor(random() * max);

  switch (difficulty) {
    case 'interference':
      return {
        difficulty,
        lanes: LANES.map((lane, index) => {
          const failingSample = index === target ? -1 : sample(4);
          const samples = Array.from({ length: 4 }, (_, at) => {
            const peak = index === (target + 1) % LANES.length && at === 0;
            const reference = 2 + sample(8) + (peak ? 20 : 0);
            const residual = (at === failingSample ? 0 : RESIDUAL_MIN) + sample(RESIDUAL_MIN);
            return { receiver: reference + residual, reference };
          });
          return { lane, samples };
        }),
      };
    case 'periodicity': {
      const period = PERIODS[target]!;
      return {
        difficulty,
        ticks: Array.from({ length: 24 }, (_, tick) =>
          tick % period === 0 ? DETECTION_MIN + sample(5) : sample(4),
        ),
      };
    }
    case 'hidden-pattern': {
      const reference = sample(16);
      return {
        difficulty,
        reference: bits(reference),
        slots: SLOTS.map((slot, index) => {
          const first = index === target || index === (target + 1) % SLOTS.length;
          const second = index === target || index === (target + 2) % SLOTS.length;
          return {
            slot,
            words: [first, second].map((matches) =>
              bits(reference ^ (matches ? 0 : 1 + sample(15))),
            ),
          };
        }),
      };
    }
  }
}

export function evaluateSubmission(scenario: Scenario, candidate: string): Submission {
  switch (scenario.difficulty) {
    case 'interference': {
      const lane = scenario.lanes.find(({ lane }) => lane === candidate);
      if (!lane) return { result: 'invalid' };
      const residuals = lane.samples.map(({ receiver, reference }) => receiver - reference);
      const failed = residuals.findIndex((residual) => residual < RESIDUAL_MIN);
      return failed === -1
        ? { result: 'correct' }
        : { result: 'interference', sample: failed + 1, residual: residuals[failed]! };
    }
    case 'periodicity': {
      const period = PERIODS.find((period) => String(period) === candidate);
      if (!period) return { result: 'invalid' };
      const pulse = (tick: number) => tick % period === 0;
      const tick = scenario.ticks.findIndex(
        (level, tick) => level >= DETECTION_MIN !== pulse(tick),
      );
      return tick === -1
        ? { result: 'correct' }
        : {
            result: 'periodicity',
            tick,
            observed: scenario.ticks[tick]! >= DETECTION_MIN,
            predicted: pulse(tick),
          };
    }
    case 'hidden-pattern': {
      const slot = scenario.slots.find(({ slot }) => slot === candidate);
      if (!slot) return { result: 'invalid' };
      const failed = slot.words.findIndex((word) => word !== scenario.reference);
      return failed === -1
        ? { result: 'correct' }
        : {
            result: 'hidden-pattern',
            frame: failed + 1,
            word: slot.words[failed]!,
            reference: scenario.reference,
          };
    }
  }
}
