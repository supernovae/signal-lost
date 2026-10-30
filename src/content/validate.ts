import type { z } from 'zod';
import { FACT_KINDS, factsIn, type Condition, type FactPrefix } from './conditions.ts';
import {
  CONTENT_SCHEMA_VERSION,
  hashContent,
  type Manifest,
  type ManifestEntry,
} from './manifest.ts';
import {
  archiveSchema,
  artifactSchema,
  characterSchema,
  communitySchema,
  episodeSchema,
  puzzleSchema,
  sectorSchema,
  transmissionSchema,
  type Content,
} from './schema.ts';

export interface ContentError {
  file: string;
  field: string;
  message: string;
}

export interface LoadResult {
  content: Content;
  errors: ContentError[];
  manifest: Manifest;
}

/** A file whose text was not valid JSON, as produced by the content readers. */
export class JsonParseFailure {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

const SCHEMAS: Record<keyof Content, z.ZodType> = {
  episodes: episodeSchema,
  puzzles: puzzleSchema,
  transmissions: transmissionSchema,
  archives: archiveSchema,
  characters: characterSchema,
  sectors: sectorSchema,
  artifacts: artifactSchema,
  community: communitySchema,
};

function kindOf(path: string): keyof Content | undefined {
  const parts = path.split('/');
  const directory = parts[parts.lastIndexOf('content') + 1];
  return directory && directory in SCHEMAS ? (directory as keyof Content) : undefined;
}

export function loadContent(files: Record<string, unknown>): LoadResult {
  const errors: ContentError[] = [];
  const content: Content = {
    episodes: [],
    puzzles: [],
    transmissions: [],
    archives: [],
    characters: [],
    sectors: [],
    artifacts: [],
    community: [],
  };
  const sources = new Map<object, { file: string; prefix: string }>();
  const entries: ManifestEntry[] = [];

  for (const file of Object.keys(files).sort()) {
    const raw = files[file];
    if (raw instanceof JsonParseFailure) {
      errors.push({ file, field: '(file)', message: `invalid JSON: ${raw.message}` });
      continue;
    }
    const kind = kindOf(file);
    if (!kind) {
      errors.push({ file, field: '(file)', message: 'not inside a known content directory' });
      continue;
    }
    const parsed = SCHEMAS[kind].safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ file, field: issue.path.join('.') || '(root)', message: issue.message });
      }
      continue;
    }
    const value = parsed.data as never;
    (content[kind] as unknown[]).push(value);
    sources.set(value, { file, prefix: '' });
    entries.push({ kind, id: (value as { id: string }).id, file });
  }

  // Flatten community packages so their entries behave like any other content.
  for (const pack of content.community) {
    const file = sources.get(pack)!.file;
    for (const key of ['transmissions', 'archives'] as const) {
      pack[key].forEach((entry, index) => {
        entry.attribution ??= pack.attribution;
        sources.set(entry, { file, prefix: `${key}.${index}.` });
        (content[key] as unknown[]).push(entry);
        entries.push({ kind: key, id: entry.id, file });
      });
    }
  }

  checkDuplicates(content, sources, errors);
  checkReferences(content, sources, errors);

  entries.sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
  return {
    content,
    errors,
    manifest: {
      schemaVersion: CONTENT_SCHEMA_VERSION,
      contentVersion: hashContent(files),
      entries,
    },
  };
}

type Sources = Map<object, { file: string; prefix: string }>;

function checkDuplicates(content: Content, sources: Sources, errors: ContentError[]): void {
  for (const kind of Object.keys(content) as (keyof Content)[]) {
    const seen = new Map<string, string>();
    for (const record of content[kind]) {
      const { file, prefix } = sources.get(record)!;
      const first = seen.get(record.id);
      if (first) {
        errors.push({
          file,
          field: `${prefix}id`,
          message: `duplicate ${kind} id "${record.id}" (first defined in ${first})`,
        });
      } else {
        seen.set(record.id, file);
      }
    }
  }
}

function checkReferences(content: Content, sources: Sources, errors: ContentError[]): void {
  const ids = Object.fromEntries(
    (Object.keys(content) as (keyof Content)[]).map((kind) => [
      kind,
      new Set(content[kind].map((r) => r.id)),
    ]),
  ) as Record<keyof Content, Set<string>>;

  const granted = new Set<string>();
  for (const record of [...content.episodes, ...content.puzzles]) {
    record.grants.forEach((g) => granted.add(g));
  }
  content.sectors.forEach((s) => s.grantsOnEnter.forEach((g) => granted.add(g)));

  const checkFact = (fact: string, record: object, field: string, isGrant: boolean): void => {
    const { file, prefix } = sources.get(record)!;
    const [head, name] = fact.split(':') as [FactPrefix, string];
    const kind = FACT_KINDS[head];
    if (kind === null) {
      if (!isGrant && !granted.has(fact)) {
        errors.push({ file, field: prefix + field, message: `nothing grants "${fact}"` });
      }
    } else if (!ids[kind].has(name)) {
      errors.push({
        file,
        field: prefix + field,
        message: `unknown fact "${fact}": no ${kind} record has id "${name}"`,
      });
    }
  };
  const checkCondition = (condition: Condition | undefined, record: object, field: string) => {
    factsIn(condition).forEach((f) => checkFact(f, record, field, false));
  };

  for (const episode of content.episodes) {
    episode.puzzles.forEach((puzzle, i) => {
      if (!ids.puzzles.has(puzzle)) {
        const { file } = sources.get(episode)!;
        errors.push({ file, field: `puzzles.${i}`, message: `unknown puzzle "${puzzle}"` });
      }
    });
    episode.grants.forEach((g, i) => checkFact(g, episode, `grants.${i}`, true));
  }
  for (const puzzle of content.puzzles) {
    checkCondition(puzzle.requires, puzzle, 'requires');
    puzzle.grants.forEach((g, i) => checkFact(g, puzzle, `grants.${i}`, true));
  }
  for (const record of [...content.transmissions, ...content.archives, ...content.artifacts]) {
    checkCondition(record.requires, record, 'requires');
  }
  for (const character of content.characters) {
    character.lines.forEach((line, i) => checkCondition(line.when, character, `lines.${i}.when`));
  }
  for (const sector of content.sectors) {
    checkCondition(sector.visibleWhen, sector, 'visibleWhen');
    checkCondition(sector.enterableWhen, sector, 'enterableWhen');
    sector.grantsOnEnter.forEach((g, i) => checkFact(g, sector, `grantsOnEnter.${i}`, true));
  }
}

export function formatErrors(errors: ContentError[]): string {
  return errors.map((e) => `${e.file}: ${e.field}: ${e.message}`).join('\n');
}
