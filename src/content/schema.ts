import { z } from 'zod';
import { bbsThemeIds } from '../bbs/themes.ts';
import type { Condition } from './conditions.ts';

const id = z
  .string()
  .regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/, 'use lowercase letters, digits, . and -');
const fact = z
  .string()
  .regex(/^(solved|acquired|read|discovered|completed|flag):[a-z0-9]+([.-][a-z0-9]+)*$/, {
    message: 'a fact looks like "solved:puzzle.carrier"',
  });
const text = z.array(z.string());
const conditionFact = z.union([fact, z.string().regex(/^bbs-read:[a-z0-9]+([.-][a-z0-9]+)*$/)]);

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    conditionFact,
    z.strictObject({ all: z.array(condition) }),
    z.strictObject({ any: z.array(condition) }),
    z.strictObject({ not: condition }),
  ]),
);

const attribution = z.strictObject({
  author: z.string().min(1),
  handle: z.string().optional(),
  sourcePr: z.string().optional(),
});

const record = {
  id,
  attribution: attribution.optional(),
  provenance: z.string().optional(),
};

type AccessCondition = string | { all: AccessCondition[] } | { any: AccessCondition[] };
const accessCondition: z.ZodType<AccessCondition> = z.lazy(() =>
  z.union([
    conditionFact,
    z.strictObject({ all: z.array(accessCondition).min(1) }),
    z.strictObject({ any: z.array(accessCondition).min(1) }),
  ]),
);

export const accessLevelSchema = z
  .strictObject({
    ...record,
    label: z.string().trim().min(1),
    rank: z.number().int().nonnegative(),
    when: accessCondition.optional(),
  })
  .refine(({ rank, when }) => (rank === 0 ? when === undefined : when !== undefined), {
    path: ['when'],
    message: 'rank 0 must be unconditional and positive ranks must have a condition',
  });

const capabilityBase = {
  ...record,
  fact: conditionFact,
  context: z.array(conditionFact).default([]),
};

export const capabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...capabilityBase,
    kind: z.literal('research'),
    target: z.strictObject({ kind: z.enum(['archive', 'board']), id }),
  }),
  z.strictObject({
    ...capabilityBase,
    kind: z.literal('reputation'),
    target: z.strictObject({ characterId: id, lineId: id }),
  }),
]);

const origin = z.enum(['fictional', 'reviewed-community']).default('fictional');
const messageTone = z.enum(['history', 'ai-fictional', 'recovered', 'private']);

export const episodeSchema = z.strictObject({
  ...record,
  title: z.string(),
  puzzles: z.array(id).min(1),
  ending: text,
  grants: z.array(fact).default([]),
  designationPrefix: z.string().min(1),
});

const puzzleBase = {
  ...record,
  title: z.string(),
  briefing: text,
  requires: condition.optional(),
  grants: z.array(fact).default([]),
  success: text.default([]),
};

export const signalLineSchema = z.strictObject({
  freqMhz: z.number(),
  driftHzPerSec: z.number(),
  amplitude: z.number().positive(),
  terrestrial: z.boolean(),
});

export const carrierSignalSchema = z.strictObject({
  seed: z.number().int(),
  startMhz: z.number(),
  binHz: z.number().positive(),
  bins: z.number().int().positive(),
  rows: z.number().int().positive(),
  secondsPerRow: z.number().positive(),
  noiseFloor: z.number().positive(),
  lines: z.array(signalLineSchema).min(1),
});

const carrierPuzzle = z.strictObject({
  ...puzzleBase,
  kind: z.literal('carrier'),
  signal: carrierSignalSchema,
  bandwidthsHz: z.array(z.number().positive()).min(1),
  solution: z.strictObject({ minSnr: z.number().positive(), toleranceHz: z.number().positive() }),
  feedback: z.strictObject({
    terrestrial: text,
    weak: text,
    noLine: text,
  }),
});

const rasterPuzzle = z.strictObject({
  ...puzzleBase,
  kind: z.literal('raster'),
  bits: z.string().regex(/^[01]+$/, 'bits may contain only 0 and 1'),
  solution: z.strictObject({ width: z.number().int().positive(), answer: z.string() }),
  knownWrong: z.array(z.strictObject({ answer: z.string(), feedback: text })).default([]),
  feedback: z.strictObject({ width: text, answer: text }),
});

const inquiryPuzzle = z.strictObject({
  ...puzzleBase,
  kind: z.literal('inquiry'),
  fields: z
    .array(
      z.strictObject({
        id,
        label: z.string(),
        answer: z.string(),
        options: z.array(z.string()).optional(),
      }),
    )
    .min(1),
});

const codePuzzle = z.strictObject({
  ...puzzleBase,
  kind: z.literal('code'),
  answer: z.string(),
  feedback: text,
});

export const puzzleSchema = z.discriminatedUnion('kind', [
  carrierPuzzle,
  rasterPuzzle,
  inquiryPuzzle,
  codePuzzle,
]);

export const transmissionSchema = z.strictObject({
  ...record,
  title: z.string(),
  body: text,
  requires: condition.optional(),
});

export const archiveSchema = z.strictObject({
  ...record,
  origin,
  presentation: messageTone.default('recovered'),
  board: z.string(),
  title: z.string(),
  from: z.string(),
  date: z.string(),
  body: text,
  requires: condition.optional(),
  keywords: z.array(z.string()).default([]),
  searchOnly: z.boolean().default(false),
});

export const bbsBoardSchema = z
  .strictObject({
    ...record,
    kind: z.literal('board'),
    title: z.string().min(1),
    requires: condition,
    notice: z.string().min(1),
    banner: text.min(1),
    sysopGreeting: text.min(1).optional(),
    sysopCharacterId: id.optional(),
    archiveIds: z.array(id),
    status: z.array(z.strictObject({ when: condition, text: z.string().min(1) })).default([]),
    doorError: z.string().min(1).optional(),
  })
  .refine(({ sysopGreeting, sysopCharacterId }) => sysopGreeting || sysopCharacterId, {
    path: ['sysopCharacterId'],
    message: 'a BBS endpoint needs a SYSOP character or static greeting',
  });

export const bbsMessageSchema = z.strictObject({
  ...record,
  kind: z.literal('message'),
  origin,
  presentation: messageTone.default('history'),
  board: id,
  title: z.string().min(1),
  from: z.string().min(1),
  date: z.string().min(1),
  body: text.min(1),
  eventOnly: z.boolean().default(false),
});

export const eventSchema = z.strictObject({
  ...record,
  when: condition,
  effects: z
    .array(
      z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('grant-flag'), flag: id }),
        z.strictObject({ kind: z.literal('post-bulletin'), messageId: id }),
      ]),
    )
    .min(1),
});

export const bbsCheckVerbs = ['SEARCH', 'SUBMIT'] as const;
const checkLine = z.string().trim().min(1);

export const bbsMessageBoardSchema = z.strictObject({
  ...record,
  kind: z.literal('message-board'),
  bbs: id,
  title: z.string().min(1),
  description: text,
  access: z.strictObject({ level: id, deniedText: z.string().trim().min(1) }).optional(),
  requires: condition.optional(),
  check: z
    .strictObject({
      verb: z.enum(bbsCheckVerbs),
      answer: z.string().regex(/^\S+$/, 'use one nonblank answer token'),
      evidenceMessageIds: z
        .array(id)
        .min(1)
        .refine((ids) => new Set(ids).size === ids.length, 'evidence messages must be unique'),
      prompt: checkLine,
      missingEvidence: checkLine,
      incorrect: checkLine,
      responseMessageId: id,
    })
    .optional(),
});

export const bbsThreadSchema = z.strictObject({
  ...record,
  kind: z.literal('thread'),
  board: id,
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  messages: z.array(z.strictObject({ kind: z.enum(['message', 'archive']), id })).min(1),
  replies: z.array(z.strictObject({ id, label: z.string().min(1), messageId: id })).default([]),
});

export const bbsProfileSchema = z.strictObject({
  ...record,
  kind: z.literal('profile'),
  bbs: id,
  characterId: id,
  handle: z.string().min(1),
  bio: text.min(1),
});

export const bbsSecretSchema = z.strictObject({
  ...record,
  kind: z.literal('secret'),
  bbs: id,
  command: z.string().regex(/^[A-Za-z][A-Za-z0-9-]*$/),
  clueMessageId: id,
  output: text.min(1),
});

export const bbsPublicCommands = [
  'CONNECT',
  'DESIGNATION',
  'LOGIN',
  'HELP',
  'DISCONNECT',
  'MENU',
  'BACK',
  'MESSAGES',
  'READ',
  'SYSOP',
  'DOORS',
  'OPEN',
  'EXIT',
  'BOARDS',
  'BOARD',
  'THREAD',
  'REPLY',
  'PEOPLE',
  'PROFILE',
  'TALK',
  'DIRECTORY',
  'NETWORK',
  'HISTORY',
  'SETTINGS',
] as const;

const bbsTones = [
  'system',
  'history',
  'sysop',
  'ai-fictional',
  'recovered',
  'private',
  'door',
  'network-error',
  'restricted',
] as const;
const bbsHistoryKinds = [
  'sign-in',
  'board',
  'thread',
  'read',
  'profile',
  'directory',
  'doors',
  'network',
  'door',
  'reply',
  'secret',
  'disconnect',
] as const;
export const bbsInterfaceSchema = z.strictObject({
  ...record,
  kind: z.literal('interface'),
  actions: z.record(z.enum(bbsPublicCommands), z.string()),
  tones: z.record(z.enum(bbsTones), z.string()),
  history: z.record(z.enum(bbsHistoryKinds), z.string()),
  origins: z.record(z.enum(['fictional', 'reviewed-community']), z.string()),
  themes: z.record(z.enum(bbsThemeIds), z.string()),
  text: z.strictObject({
    prompt: z.string(),
    handle: z.string(),
    signIn: z.string(),
    title: z.string(),
    accessLevel: z.string(),
    loginHint: z.string(),
    customHint: z.string(),
    menuHint: z.string(),
    viewHint: z.string(),
    messagesHint: z.string(),
    noMessages: z.string(),
    noThreads: z.string(),
    doorsHint: z.string(),
    noDoors: z.string(),
    doorHint: z.string(),
    doorUnavailable: z.string(),
    doorError: z.string(),
    doorDirectory: z.string(),
    connected: z.string(),
    disconnected: z.string(),
    noDesignation: z.string(),
    enterHandle: z.string(),
    chooseMessage: z.string(),
    chooseDoor: z.string(),
    invalid: z.string(),
    section: z.string(),
    listing: z.string(),
    doorListing: z.string(),
    from: z.string(),
    date: z.string(),
    credit: z.string(),
    read: z.string(),
    unread: z.string(),
    newItem: z.string(),
    noDialogue: z.string(),
    marked: z.string(),
    profile: z.string(),
    chosen: z.string(),
    available: z.string(),
    restricted: z.string(),
    emptyHistory: z.string(),
    removed: z.string(),
    discoveryKnown: z.string(),
    saveRefused: z.string(),
    theme: z.string(),
  }),
});

export const bbsSchema = z.discriminatedUnion('kind', [
  bbsBoardSchema,
  bbsMessageSchema,
  bbsMessageBoardSchema,
  bbsThreadSchema,
  bbsProfileSchema,
  bbsSecretSchema,
  bbsInterfaceSchema,
]);

export const doorMetadataSchema = z.strictObject({
  ...record,
  attribution,
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.number().int().positive(),
  requires: condition,
  rewards: z.array(fact),
  returnTo: z.literal('bbs-menu'),
});

const triviaQuestion = z
  .strictObject({
    prompt: text.min(1),
    options: z.array(z.string().min(1)).min(2),
    answer: z.number().int().nonnegative(),
    retry: text.min(1),
  })
  .refine(({ answer, options }) => answer < options.length, {
    path: ['answer'],
    message: 'answer must be a zero-based index into options',
  });

export const triviaDoorSchema = doorMetadataSchema.extend({
  kind: z.literal('trivia'),
  saveState: z.literal('question-index'),
  completion: z.literal('all-correct'),
  questions: z.array(triviaQuestion).min(1),
  success: text.min(1),
});

const adventureActionFields = {
  command: z.string().trim().min(1),
  label: z.string().min(1),
  when: condition.optional(),
};

const adventureAction = z.discriminatedUnion('kind', [
  z.strictObject({ ...adventureActionFields, kind: z.literal('move'), toLocationId: id }),
  z.strictObject({ ...adventureActionFields, kind: z.literal('inspect'), itemId: id }),
  z.strictObject({
    ...adventureActionFields,
    kind: z.literal('talk'),
    variants: z.array(z.strictObject({ when: condition.optional(), text: text.min(1) })).min(1),
  }),
  z.strictObject({ ...adventureActionFields, kind: z.literal('show'), text: text.min(1) }),
  z.strictObject({
    ...adventureActionFields,
    kind: z.literal('order'),
    puzzleId: id,
    operationIds: z.array(id).min(1),
  }),
  z.strictObject({ ...adventureActionFields, kind: z.literal('end'), endingId: id }),
]);

const orderPuzzle = z.strictObject({
  id,
  requiredItemIds: z.array(id),
  operations: z
    .array(
      z.strictObject({
        id,
        inputs: z.array(z.strictObject({ token: id, missing: text.min(1) })),
        outputs: z.array(id),
      }),
    )
    .min(1),
  successFlag: id,
  inspectFirst: text.min(1),
  success: text.min(1),
});

export const adventureDoorSchema = doorMetadataSchema.extend({
  kind: z.literal('adventure'),
  startLocationId: id,
  locations: z
    .array(
      z.strictObject({
        id,
        title: z.string().min(1),
        description: text.min(1),
        actions: z.array(adventureAction),
      }),
    )
    .min(1),
  items: z.array(z.strictObject({ id, text: text.min(1) })),
  flags: z.array(id),
  endings: z.array(z.strictObject({ id, text: text.min(1) })).min(1),
  orderPuzzles: z.array(orderPuzzle),
  rewardRules: z.array(z.strictObject({ reward: fact, when: condition })),
});

export const declarativeDoorSchema = z.discriminatedUnion('kind', [
  triviaDoorSchema,
  adventureDoorSchema,
]);

export const characterSchema = z.strictObject({
  ...record,
  name: z.string(),
  lines: z.array(
    z.strictObject({
      id,
      kind: z.enum(['reaction', 'hint', 'idle', 'bbs']),
      when: condition.optional(),
      failures: z.strictObject({ puzzle: id, atLeast: z.number().int().positive() }).optional(),
      text,
      priority: z.number().int().default(0),
      once: z.boolean().default(false),
    }),
  ),
});

export const sectorSchema = z.strictObject({
  ...record,
  name: z.string(),
  position: z.strictObject({ x: z.number(), y: z.number() }),
  description: text,
  visibleWhen: condition.optional(),
  enterableWhen: condition.optional(),
  lockedText: text.default([]),
  grantsOnEnter: z.array(fact).default([]),
  opens: z.literal('archive').optional(),
  puzzle: id.optional(),
});

export const artifactSchema = z.strictObject({
  ...record,
  name: z.string(),
  description: text,
  requires: condition.optional(),
  links: z.array(z.strictObject({ label: z.string(), url: z.url() })).default([]),
  grantsOnOpen: z.array(fact).default([]),
});

export const screenSchema = z.strictObject({
  ...record,
  lines: text,
});

export const communitySchema = z.strictObject({
  ...record,
  title: z.string(),
  transmissions: z.array(transmissionSchema).default([]),
  archives: z.array(archiveSchema).default([]),
});

export type Episode = z.infer<typeof episodeSchema>;
export type AccessLevel = z.infer<typeof accessLevelSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Puzzle = z.infer<typeof puzzleSchema>;
export type CarrierPuzzle = z.infer<typeof carrierPuzzle>;
export type RasterPuzzle = z.infer<typeof rasterPuzzle>;
export type InquiryPuzzle = z.infer<typeof inquiryPuzzle>;
export type CodePuzzle = z.infer<typeof codePuzzle>;
export type CarrierSignal = z.infer<typeof carrierSignalSchema>;
export type Transmission = z.infer<typeof transmissionSchema>;
export type Archive = z.infer<typeof archiveSchema>;
export type BbsBoard = z.infer<typeof bbsBoardSchema>;
export type BbsMessage = z.infer<typeof bbsMessageSchema>;
export type NetworkEvent = z.infer<typeof eventSchema>;
export type BbsRecord = z.infer<typeof bbsSchema>;
export type BbsThread = z.infer<typeof bbsThreadSchema>;
export type BbsTone = (typeof bbsTones)[number];
export type DoorMetadata = z.infer<typeof doorMetadataSchema>;
export type TriviaDoor = z.infer<typeof triviaDoorSchema>;
export type AdventureDoor = z.infer<typeof adventureDoorSchema>;
export type DeclarativeDoor = z.infer<typeof declarativeDoorSchema>;
export type Character = z.infer<typeof characterSchema>;
export type DialogueLine = Character['lines'][number];
export type Sector = z.infer<typeof sectorSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Screen = z.infer<typeof screenSchema>;
export type CommunityPackage = z.infer<typeof communitySchema>;

export interface Content {
  accessLevels: AccessLevel[];
  capabilities: Capability[];
  episodes: Episode[];
  puzzles: Puzzle[];
  transmissions: Transmission[];
  archives: Archive[];
  bbs: BbsRecord[];
  events: NetworkEvent[];
  doors: DeclarativeDoor[];
  characters: Character[];
  sectors: Sector[];
  artifacts: Artifact[];
  screens: Screen[];
  community: CommunityPackage[];
}
