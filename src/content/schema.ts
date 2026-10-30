import { z } from 'zod';
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

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    fact,
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
  board: z.string(),
  title: z.string(),
  from: z.string(),
  date: z.string(),
  body: text,
  requires: condition.optional(),
  keywords: z.array(z.string()).default([]),
  searchOnly: z.boolean().default(false),
});

export const characterSchema = z.strictObject({
  ...record,
  name: z.string(),
  lines: z.array(
    z.strictObject({
      id,
      kind: z.enum(['reaction', 'hint', 'idle']),
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
export type Puzzle = z.infer<typeof puzzleSchema>;
export type CarrierPuzzle = z.infer<typeof carrierPuzzle>;
export type RasterPuzzle = z.infer<typeof rasterPuzzle>;
export type InquiryPuzzle = z.infer<typeof inquiryPuzzle>;
export type CodePuzzle = z.infer<typeof codePuzzle>;
export type CarrierSignal = z.infer<typeof carrierSignalSchema>;
export type Transmission = z.infer<typeof transmissionSchema>;
export type Archive = z.infer<typeof archiveSchema>;
export type Character = z.infer<typeof characterSchema>;
export type DialogueLine = Character['lines'][number];
export type Sector = z.infer<typeof sectorSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Screen = z.infer<typeof screenSchema>;
export type CommunityPackage = z.infer<typeof communitySchema>;

export interface Content {
  episodes: Episode[];
  puzzles: Puzzle[];
  transmissions: Transmission[];
  archives: Archive[];
  characters: Character[];
  sectors: Sector[];
  artifacts: Artifact[];
  screens: Screen[];
  community: CommunityPackage[];
}
