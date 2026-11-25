import { z } from 'zod';
import { fill } from '../../bbs/copy.ts';
import { defineDoor, type DoorProgress, type DoorScreen } from '../contract.ts';
import {
  choices,
  DETECTION_MIN,
  DIFFICULTIES,
  evaluateSubmission,
  generateScenario,
  RESIDUAL_MIN,
  type Difficulty,
  type Scenario,
} from './scenario.ts';

const manifestFact = 'flag:manifest-r07-spool-02';
const cardId = z.enum(['H1', 'H2', 'H3']);
const tierId = z.enum(DIFFICULTIES);
const line = z.string().min(1);
// Vite's application transform reads these files when it processes the lazy door module.
const assets = import.meta.glob<string>(
  ['/content/code-doors/signal-hunter.jsonc', '/content/code-doors/manifest-r07-spool-02.jsonc'],
  { eager: true, query: '?raw', import: 'default' },
);

function readAsset(path: string): unknown {
  // Prettier adds trailing commas to JSONC. Keep commas inside quoted strings intact.
  const json = assets[path]!.replace(/"(?:[^"\\]|\\.)*"|,(?=\s*[}\]])/g, (token) =>
    token === ',' ? '' : token,
  );
  return JSON.parse(json);
}

const copy = z
  .strictObject({
    request: line,
    cards: z.record(
      cardId,
      z.strictObject({ node: line, integrity: z.enum(['INTACT', 'DAMAGED']), note: line }),
    ),
    story: z.strictObject({
      help: line,
      wrongNode: line,
      wrongIntegrity: line,
      verified: line,
      held: line,
      unavailable: line,
    }),
    practice: z.strictObject({
      intro: line,
      help: line,
      choose: line,
      solved: line,
      tiers: z.record(tierId, z.strictObject({ name: line, rule: line, feedback: line })),
    }),
  })
  .parse(readAsset('/content/code-doors/signal-hunter.jsonc'));
const manifest = z
  .strictObject({ id: line, target: line, lines: z.array(line).min(1) })
  .parse(readAsset('/content/code-doors/manifest-r07-spool-02.jsonc'));

const roundState = z
  .strictObject({
    ordinal: z.number().int().min(0).max(0xffffffff),
    solved: z.boolean(),
    everSolved: z.boolean(),
  })
  .refine(({ solved, everSolved }) => !solved || everSolved);
const saveState = z.strictObject({
  hunterVerified: z.boolean(),
  lastTier: tierId.nullable(),
  tiers: z.record(tierId, roundState),
});
type Saved = z.infer<typeof saveState>;
type State = {
  saved: Saved;
  view: 'story' | 'practice' | Difficulty;
};

const action = (command: string, label = command) => ({ command, label });
const storyAction = action('STORY', 'Return to trace cards');
const practiceAction = action('PRACTICE', 'Practice menu');
const freshRound = () => ({ ordinal: 0, solved: false, everSolved: false });

function storyScreen(state: State, progress: DoorProgress, details: readonly string[]): DoorScreen {
  const held = progress.hasFact(manifestFact);
  return {
    lines: [
      'SIGNAL HUNTER',
      fill(copy.request, { manifest: manifest.id, node: manifest.target }),
      ...cardId.options.map((id) => {
        const { node, integrity, note } = copy.cards[id];
        return `${id} | ${node} / ${integrity} | ${note}`;
      }),
      ...(held ? [copy.story.held] : []),
      ...details,
    ],
    actions: [
      ...cardId.options.map((id) => action(`VERIFY ${id}`)),
      ...(held || state.saved.hunterVerified ? [action('MANIFEST', 'Read manifest')] : []),
      action('PRACTICE', 'Practice signal analysis'),
      ...(state.saved.lastTier ? [action('RESUME PRACTICE')] : []),
    ],
  };
}

function practiceMenu(saved: Saved, details: readonly string[]): DoorScreen {
  return {
    lines: [
      'SIGNAL HUNTER PRACTICE',
      copy.practice.intro,
      ...DIFFICULTIES.map((tier) => {
        const status = saved.tiers[tier].everSolved ? 'COMPLETED' : 'OPEN';
        return `${copy.practice.tiers[tier].name}: ${status} (${tier.toUpperCase()})`;
      }),
      ...details,
    ],
    actions: [
      ...DIFFICULTIES.map((tier) => action(tier.toUpperCase(), copy.practice.tiers[tier].name)),
      storyAction,
    ],
  };
}

function evidence(scenario: Scenario): string[] {
  const { rule } = copy.practice.tiers[scenario.difficulty];
  switch (scenario.difficulty) {
    case 'interference':
      return [
        fill(rule, { threshold: String(RESIDUAL_MIN) }),
        'Samples 1–4 (receiver/reference)',
        ...scenario.lanes.map(
          ({ lane, samples }) =>
            `Lane ${lane}: ${samples.map(({ receiver, reference }) => `${receiver}/${reference}`).join(' ')}`,
        ),
      ];
    case 'periodicity': {
      const ticks = scenario.ticks.map((level, tick) => `${tick}=${level}`);
      return [
        fill(rule, { threshold: String(DETECTION_MIN) }),
        'Trace (tick=level)',
        ...Array.from({ length: 4 }, (_, row) => ticks.slice(row * 6, row * 6 + 6).join(' ')),
      ];
    }
    case 'hidden-pattern':
      return [
        rule,
        `Reference word: ${scenario.reference}`,
        ...[0, 1].map(
          (frame) =>
            `Frame ${frame + 1}: ${scenario.slots.map(({ slot, words }) => `${slot}=${words[frame]}`).join(' ')}`,
        ),
      ];
  }
}

function roundScreen(
  scenario: Scenario,
  round: z.infer<typeof roundState>,
  details: readonly string[],
): DoorScreen {
  const { difficulty } = scenario;
  return {
    lines: [
      `${copy.practice.tiers[difficulty].name.toUpperCase()} | ROUND ${round.ordinal + 1}`,
      ...evidence(scenario),
      ...(round.solved ? [copy.practice.solved] : []),
      ...details,
    ],
    actions: [
      ...choices[difficulty].map((choice) => action(`SUBMIT ${choice}`)),
      action('TRACE', 'Read trace'),
      action('RETRY', 'Retry this round'),
      action('NEW', 'New round'),
      practiceAction,
      storyAction,
    ],
  };
}

function submit(scenario: Scenario, choice: string, round: z.infer<typeof roundState>): string[] {
  const answer = evaluateSubmission(scenario, choice);
  const { feedback } = copy.practice.tiers[scenario.difficulty];
  switch (answer.result) {
    case 'correct':
      round.solved = true;
      round.everSolved = true;
      return [];
    case 'invalid':
      return [copy.practice.help];
    case 'interference':
      return [
        fill(feedback, {
          choice,
          sample: String(answer.sample),
          residual: String(answer.residual),
          threshold: String(RESIDUAL_MIN),
        }),
      ];
    case 'periodicity':
      return [
        fill(feedback, {
          choice,
          tick: String(answer.tick),
          observed: answer.observed ? 'a pulse' : 'a gap',
          predicted: answer.predicted ? 'a pulse' : 'a gap',
        }),
      ];
    case 'hidden-pattern':
      return [
        fill(feedback, {
          choice,
          frame: String(answer.frame),
          word: answer.word,
          reference: answer.reference,
        }),
      ];
  }
}

function verify(saved: Saved, command: string, progress: DoorProgress): readonly string[] {
  if (command === 'MANIFEST') {
    return progress.hasFact(manifestFact) ? manifest.lines : [copy.story.unavailable];
  }
  const id = cardId.options.find((id) => command === `VERIFY ${id}`);
  if (!id) return [copy.story.help];
  const { node, integrity } = copy.cards[id];
  if (node !== manifest.target) {
    return [fill(copy.story.wrongNode, { card: id, actual: node, node: manifest.target })];
  }
  if (integrity !== 'INTACT') return [fill(copy.story.wrongIntegrity, { card: id })];
  if (progress.hasFact(manifestFact)) return manifest.lines;
  saved.hunterVerified = true;
  return [fill(copy.story.verified, { card: id }), ...manifest.lines];
}

export function createSignalHunterDoor(saveSeed: number) {
  function show(state: State, progress: DoorProgress, details: readonly string[] = []) {
    const { saved, view } = state;
    if (view === 'story') return { state, screen: storyScreen(state, progress, details) };
    if (view === 'practice') return { state, screen: practiceMenu(saved, details) };
    const round = saved.tiers[view];
    const scenario = generateScenario(saveSeed, view, round.ordinal);
    return { state, screen: roundScreen(scenario, round, details) };
  }

  return defineDoor<State, Saved>({
    saveState,
    launch: (progress) =>
      show(
        {
          view: 'story',
          saved: {
            hunterVerified: false,
            lastTier: null,
            tiers: {
              interference: freshRound(),
              periodicity: freshRound(),
              'hidden-pattern': freshRound(),
            },
          },
        },
        progress,
      ),
    restore(saved, progress) {
      if (!progress.hasFact(manifestFact)) saved.hunterVerified = false;
      return show({ saved, view: 'story' }, progress);
    },
    input(state, value, progress) {
      const command = value.trim().replace(/\s+/g, ' ').toUpperCase();
      const { saved, view } = state;
      if (command === 'STORY') return show({ saved, view: 'story' }, progress);
      if (command === 'PRACTICE') return show({ saved, view: 'practice' }, progress);

      if (view === 'story') {
        if (command === 'RESUME PRACTICE' && saved.lastTier) {
          return show({ saved, view: saved.lastTier }, progress);
        }
        return show(state, progress, verify(saved, command, progress));
      }
      if (view === 'practice') {
        const tier = DIFFICULTIES.find((tier) => command === tier.toUpperCase());
        if (!tier) return show(state, progress, [copy.practice.choose]);
        saved.lastTier = tier;
        return show({ saved, view: tier }, progress);
      }

      const round = saved.tiers[view];
      if (command === 'NEW') {
        round.ordinal = (round.ordinal + 1) >>> 0;
        round.solved = false;
      }
      if (command === 'NEW' || command === 'TRACE' || command === 'RETRY') {
        return show(state, progress);
      }
      const scenario = generateScenario(saveSeed, view, round.ordinal);
      const details = command.startsWith('SUBMIT ')
        ? submit(scenario, command.slice('SUBMIT '.length), round)
        : [copy.practice.help];
      return { state, screen: roundScreen(scenario, round, details) };
    },
    exit() {},
    save: ({ saved }) => saved,
    earnedRewards: (saved, progress) =>
      saved.hunterVerified && !progress.hasFact(manifestFact) ? [manifestFact] : [],
  });
}
