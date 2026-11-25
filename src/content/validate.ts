import { z } from 'zod';
import {
  ADVENTURE_STATE_LIMIT,
  normalizeAdventureCommand,
  reachableAdventureStates,
} from '../doors/adventure.ts';
import { CODE_DOORS } from '../doors/code-doors.ts';
import type { CodeDoorRegistration } from '../doors/contract.ts';
import { createScriptedDialogue } from '../narrative/dialogue.ts';
import { deriveAccessLevel, hasAccessLevel } from '../progress/access.ts';
import { evaluate, FACT_KINDS, factsIn, type Condition, type FactPrefix } from './conditions.ts';
import {
  CONTENT_SCHEMA_VERSION,
  hashContent,
  type Manifest,
  type ManifestEntry,
} from './manifest.ts';
import {
  accessLevelSchema,
  archiveSchema,
  artifactSchema,
  bbsCheckVerbs,
  bbsOrderVerbs,
  bbsPublicCommands,
  bbsSchema,
  capabilitySchema,
  characterSchema,
  communitySchema,
  declarativeDoorSchema,
  doorMetadataSchema,
  episodeSchema,
  eventSchema,
  puzzleSchema,
  screenSchema,
  sectorSchema,
  transmissionSchema,
  type AdventureDoor,
  type Capability,
  type Content,
  type BbsRecord,
  type DeclarativeDoor,
  type DoorMetadata,
  type NetworkEvent,
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

export function parseContentJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    return new JsonParseFailure((error as Error).message);
  }
}

function schemaErrors(file: string, error: z.ZodError): ContentError[] {
  return error.issues.map((issue) => ({
    file,
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

function jsonError(file: string, failure: JsonParseFailure): ContentError {
  return { file, field: '(file)', message: `invalid JSON: ${failure.message}` };
}

const SCHEMAS: Record<keyof Content, z.ZodType> = {
  accessLevels: accessLevelSchema,
  capabilities: capabilitySchema,
  episodes: episodeSchema,
  puzzles: puzzleSchema,
  transmissions: transmissionSchema,
  archives: archiveSchema,
  bbs: bbsSchema,
  events: eventSchema,
  doors: declarativeDoorSchema,
  characters: characterSchema,
  sectors: sectorSchema,
  artifacts: artifactSchema,
  screens: screenSchema,
  community: communitySchema,
};

function kindOf(path: string): keyof Content | undefined {
  const parts = path.split('/');
  const directory = parts[parts.lastIndexOf('content') + 1];
  if (directory === 'access-levels') return 'accessLevels';
  if (directory === 'accessLevels') return;
  return directory && Object.hasOwn(SCHEMAS, directory) ? (directory as keyof Content) : undefined;
}

export function loadContent(
  files: Record<string, unknown>,
  codeDoors: readonly CodeDoorRegistration[] = CODE_DOORS,
): LoadResult {
  const errors: ContentError[] = [];
  const content: Content = {
    accessLevels: [],
    capabilities: [],
    episodes: [],
    puzzles: [],
    transmissions: [],
    archives: [],
    bbs: [],
    events: [],
    doors: [],
    characters: [],
    sectors: [],
    artifacts: [],
    screens: [],
    community: [],
  };
  const sources = new Map<object, { file: string; prefix: string }>();
  const entries: ManifestEntry[] = [];

  for (const file of Object.keys(files).sort()) {
    const raw = files[file];
    if (raw instanceof JsonParseFailure) {
      errors.push(jsonError(file, raw));
      continue;
    }
    const kind = kindOf(file);
    if (!kind) {
      errors.push({ file, field: '(file)', message: 'not inside a known content directory' });
      continue;
    }
    const parsed = SCHEMAS[kind].safeParse(raw);
    if (!parsed.success) {
      schemaErrors(file, parsed.error).forEach((error) => errors.push(error));
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

  const doors: DoorMetadata[] = [...content.doors];
  for (const { metadata, source } of codeDoors) {
    const parsed = doorMetadataSchema.safeParse(metadata);
    if (!parsed.success) {
      schemaErrors(source, parsed.error).forEach((error) => errors.push(error));
      continue;
    }
    doors.push(parsed.data);
    sources.set(parsed.data, { file: source, prefix: '' });
  }
  checkDuplicates(content, doors, sources, errors);
  checkReferences(content, doors, sources, errors);

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

export type DoorSelection =
  | { kind: 'declarative'; door: DeclarativeDoor }
  | { kind: 'code'; registration: CodeDoorRegistration };

type DoorValidation = DoorSelection | { kind: 'error'; errors: ContentError[] };

export function validateDoorById(
  files: Record<string, unknown>,
  id: string,
  codeDoors: readonly CodeDoorRegistration[] = CODE_DOORS,
): DoorValidation {
  const doorFiles = Object.keys(files)
    .filter((file) => file.startsWith('content/doors/') && file.endsWith('.json'))
    .sort();
  const matchingFiles = doorFiles.filter((file) => asRecord(files[file])?.id === id);
  const matchingCode = codeDoors.filter(({ metadata }) => asRecord(metadata)?.id === id);
  const sources = [...matchingFiles, ...matchingCode.map(({ source }) => source)];
  if (sources.length > 1) {
    return {
      kind: 'error',
      errors: sources.map((file, index) => ({
        file,
        field: 'id',
        message: `duplicate door id "${id}" (also defined in ${sources.filter((_, i) => i !== index).join(', ')})`,
      })),
    };
  }

  let selection: DoorSelection;
  let file: string;
  const declarative = matchingFiles[0];
  const code = matchingCode[0];
  if (code) {
    file = code.source;
    const parsed = doorMetadataSchema.safeParse(code.metadata);
    if (!parsed.success) return { kind: 'error', errors: schemaErrors(file, parsed.error) };
    selection = { kind: 'code', registration: { ...code, metadata: parsed.data } };
  } else if (declarative) {
    file = declarative;
    const parsed = declarativeDoorSchema.safeParse(files[file]);
    if (!parsed.success) return { kind: 'error', errors: schemaErrors(file, parsed.error) };
    selection = { kind: 'declarative', door: parsed.data };
  } else {
    const fallbackErrors = doorFiles
      .filter((path) => path.split('/').at(-1) === `${id}.json`)
      .flatMap((path) => {
        const raw = files[path];
        if (raw instanceof JsonParseFailure) return [jsonError(path, raw)];
        const parsed = doorMetadataSchema.shape.id.safeParse(asRecord(raw)?.id);
        return parsed.success
          ? []
          : parsed.error.issues.map(({ message }) => ({ file: path, field: 'id', message }));
      });
    return {
      kind: 'error',
      errors: fallbackErrors.length
        ? fallbackErrors
        : [{ file: 'content/doors', field: 'id', message: `unknown door "${id}"` }],
    };
  }

  const references = createFactReferences();
  for (const [path, raw] of Object.entries(files)) {
    const kind = kindOf(path);
    if (kind) indexFactRecord(references, kind, raw);
  }
  codeDoors.forEach(({ metadata }) => indexFactRecord(references, 'doorMetadata', metadata));

  const errors: ContentError[] = [];
  const report: Report = (field, message) => errors.push({ file, field, message });
  checkDoorFacts(
    selection.kind === 'code' ? selection.registration.metadata : selection.door,
    references,
    report,
  );
  if (selection.kind === 'declarative' && selection.door.kind === 'adventure') {
    checkAdventureReferences(selection.door, report);
  }
  return errors.length ? { kind: 'error', errors } : selection;
}

function checkBbsReferences(
  content: Content,
  report: (entry: BbsRecord, field: string, message: string) => void,
): void {
  const endpoints = new Set(
    content.bbs.filter((entry) => entry.kind === 'board').map((entry) => entry.id),
  );
  const boards = new Map(
    content.bbs.filter((entry) => entry.kind === 'message-board').map((entry) => [entry.id, entry]),
  );
  const messages = new Map(
    content.bbs.filter((entry) => entry.kind === 'message').map((entry) => [entry.id, entry]),
  );
  const archives = new Map(content.archives.map((entry) => [entry.id, entry]));
  const characters = new Map(content.characters.map((entry) => [entry.id, entry]));
  const threads = content.bbs.filter((entry) => entry.kind === 'thread');
  const publicPosts = new Set(
    threads.flatMap((thread) =>
      thread.messages
        .filter((ref) => ref.kind === 'message' && messages.get(ref.id)?.board === thread.board)
        .map((ref) => ref.id),
    ),
  );
  const commands = new Map<string, Set<string>>();
  const responseClaims = new Map<string, number>();
  for (const { check, orderCheck } of boards.values()) {
    const responseCheck = check ?? orderCheck;
    if (!responseCheck) continue;
    const { responseMessageId: id } = responseCheck;
    responseClaims.set(id, (responseClaims.get(id) ?? 0) + 1);
  }

  for (const entry of boards.values()) {
    const { check, orderCheck } = entry;
    check?.evidenceMessageIds.forEach((id, index) => {
      const field = `check.evidenceMessageIds.${index}`;
      const post = messages.get(id);
      if (!post) {
        report(entry, field, `unknown BBS message "${id}"`);
      } else if (
        post.eventOnly ||
        !publicPosts.has(id) ||
        boards.get(post.board)?.bbs !== entry.bbs
      ) {
        report(entry, field, 'evidence must be a public thread message on this endpoint');
      }
    });

    const responseCheck = check ?? orderCheck;
    if (!responseCheck) continue;
    const field = orderCheck ? 'orderCheck.responseMessageId' : 'check.responseMessageId';
    const { responseMessageId: id } = responseCheck;
    const response = messages.get(id);
    if (!response?.eventOnly || response.board !== entry.bbs) {
      report(entry, field, 'response must be an event-only message on this endpoint');
      continue;
    }
    if (responseClaims.get(id) !== 1) {
      report(entry, field, 'response must belong to exactly one board check');
    }
    const publications = content.events.flatMap((event) =>
      event.effects
        .filter((effect) => effect.kind === 'post-bulletin' && effect.messageId === id)
        .map(() => event.when),
    );
    if (publications.length !== 1 || publications[0] !== `bbs-read:${id}`) {
      report(entry, field, 'response needs one bulletin posting triggered by its own BBS read');
    }
  }

  for (const entry of content.bbs) {
    if ('bbs' in entry && !endpoints.has(entry.bbs)) {
      report(entry, 'bbs', `unknown BBS endpoint "${entry.bbs}"`);
    }
    if (entry.kind === 'message' && !endpoints.has(entry.board)) {
      if (entry.eventOnly)
        report(entry, 'board', 'an event bulletin must belong to a BBS endpoint');
      else if (!boards.has(entry.board))
        report(entry, 'board', `unknown BBS board "${entry.board}"`);
    }
    if (entry.kind === 'profile' && !characters.has(entry.characterId)) {
      report(entry, 'characterId', `unknown character "${entry.characterId}"`);
    }
    if (entry.kind === 'board' && entry.sysopCharacterId) {
      const character = characters.get(entry.sysopCharacterId);
      if (!character) {
        report(entry, 'sysopCharacterId', `unknown character "${entry.sysopCharacterId}"`);
      } else if (
        !character.lines.some(
          (line) =>
            line.kind === 'bbs' && !line.when && !line.failures && !line.once && line.text.length,
        )
      ) {
        report(entry, 'sysopCharacterId', 'SYSOP needs a repeatable, unconditional BBS line');
      }
    }
    if (entry.kind === 'thread') {
      if (!boards.has(entry.board))
        report(entry, 'board', `unknown message board "${entry.board}"`);
      entry.messages.forEach((ref, i) => {
        const field = `messages.${i}.id`;
        if (ref.kind === 'message') {
          const post = messages.get(ref.id);
          if (!post) report(entry, field, `unknown BBS message "${ref.id}"`);
          else if (post.board !== entry.board)
            report(entry, field, 'message must belong to the same board');
        } else {
          const archive = archives.get(ref.id);
          if (!archive) report(entry, field, `unknown archive "${ref.id}"`);
          else if (archive.searchOnly)
            report(entry, field, 'search-only archives cannot appear in threads');
        }
      });
      const replies = new Set<string>();
      entry.replies.forEach((reply, i) => {
        if (replies.has(reply.id))
          report(entry, `replies.${i}.id`, `duplicate reply "${reply.id}"`);
        replies.add(reply.id);
        const field = `replies.${i}.messageId`;
        const post = messages.get(reply.messageId);
        if (!post) report(entry, field, `unknown BBS message "${reply.messageId}"`);
        else if (post.board !== entry.board)
          report(entry, field, 'reply must belong to the same board');
        else if (publicPosts.has(post.id))
          report(entry, field, 'reply cannot also be a public thread post');
      });
    }
    if (entry.kind === 'secret') {
      const tokens =
        commands.get(entry.bbs) ??
        new Set<string>([...bbsPublicCommands, ...bbsCheckVerbs, ...bbsOrderVerbs]);
      const token = entry.command.toUpperCase();
      if (tokens.has(token))
        report(entry, 'command', `reserved or duplicate BBS command "${token}"`);
      tokens.add(token);
      commands.set(entry.bbs, tokens);
      const reachable = threads.some(
        (thread) =>
          boards.get(thread.board)?.bbs === entry.bbs &&
          thread.messages.some((ref) => {
            if (ref.id !== entry.clueMessageId) return false;
            if (ref.kind === 'message') return messages.get(ref.id)?.board === thread.board;
            const archive = archives.get(ref.id);
            return archive && !archive.searchOnly && !archive.requires;
          }),
      );
      if (!reachable)
        report(entry, 'clueMessageId', 'secret needs a public thread clue on this endpoint');
    }
  }
}

function checkDuplicates(
  content: Content,
  doors: readonly DoorMetadata[],
  sources: Sources,
  errors: ContentError[],
): void {
  for (const kind of Object.keys(content) as (keyof Content)[]) {
    const seen = new Map<string, string>();
    for (const record of kind === 'doors' ? doors : content[kind]) {
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

function checkEventCycles(
  events: readonly NetworkEvent[],
  report: (event: NetworkEvent, cycle: string[]) => void,
): void {
  const consumers = new Map<string, NetworkEvent[]>();
  for (const event of events) {
    for (const fact of new Set(factsIn(event.when))) {
      const entries = consumers.get(fact) ?? [];
      entries.push(event);
      consumers.set(fact, entries);
    }
  }

  const active = new Set<NetworkEvent>();
  const visited = new Set<NetworkEvent>();
  function visit(event: NetworkEvent): void {
    if (active.has(event)) {
      const path = [...active];
      report(
        event,
        [...path.slice(path.indexOf(event)), event].map(({ id }) => id),
      );
      return;
    }
    if (visited.has(event)) return;
    active.add(event);
    for (const effect of event.effects) {
      if (effect.kind !== 'grant-flag') continue;
      for (const consumer of consumers.get(`flag:${effect.flag}`) ?? []) visit(consumer);
    }
    active.delete(event);
    visited.add(event);
  }
  events.forEach(visit);
}

function checkCapabilityEffect(
  content: Content,
  capability: Capability,
  report: (message: string) => void,
): void {
  const before = new Set(capability.context);
  const after = new Set([...before, capability.fact]);
  if (capability.kind === 'research') {
    const { kind, id } = capability.target;
    if (kind === 'archive') {
      const archive = content.archives.find((entry) => entry.id === id);
      if (!archive) report(`unknown archive "${id}"`);
      else if (evaluate(archive.requires, before) || !evaluate(archive.requires, after))
        report(`the research fact must unlock archive "${id}" in the declared context`);
    } else {
      const board = content.bbs.find((entry) => entry.kind === 'message-board' && entry.id === id);
      if (board?.kind !== 'message-board') {
        report(`unknown BBS message board "${id}"`);
        return;
      }
      const { access } = board;
      const levels = content.accessLevels;
      if (
        !access ||
        hasAccessLevel(levels, deriveAccessLevel(levels, before), access.level) ||
        !evaluate(board.requires, after) ||
        !hasAccessLevel(levels, deriveAccessLevel(levels, after), access.level)
      ) {
        report(`the research fact must unlock BBS message board "${id}" in the declared context`);
      }
    }
    return;
  }

  const { characterId, lineId } = capability.target;
  const character = content.characters.find((entry) => entry.id === characterId);
  const reachable = content.bbs.some(
    (entry) =>
      (entry.kind === 'board' && entry.sysopCharacterId === characterId) ||
      (entry.kind === 'profile' && entry.characterId === characterId),
  );
  if (
    !character ||
    !reachable ||
    !character.lines.some((line) => line.id === lineId && line.kind === 'bbs')
  ) {
    report(`unknown or unreachable BBS response "${lineId}" for "${characterId}"`);
    return;
  }

  const dialogue = createScriptedDialogue(character);
  const state = { seen: new Set<string>(), failures: {} };
  const previous = dialogue.next('bbs', { ...state, facts: before });
  const next = dialogue.next('bbs', { ...state, facts: after });
  const previousText =
    previous?.text.join('\n') ??
    content.bbs.find((entry) => entry.kind === 'interface')?.text.noDialogue;
  const nextText = next?.text.join('\n');
  if (
    next?.id !== lineId ||
    previous?.id === lineId ||
    !nextText?.trim() ||
    previousText === nextText
  ) {
    report(
      `the reputation fact must select a different visible BBS response "${lineId}" in the declared context`,
    );
  }
}

function checkAdventureReferences(
  door: AdventureDoor,
  report: (field: string, message: string) => void,
): void {
  let invalid = false;
  const fail = (field: string, message: string) => {
    invalid = true;
    report(field, message);
  };
  function unique<T>(entries: readonly T[], field: string, key: (entry: T) => string, suffix = '') {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      const value = key(entry);
      if (seen.has(value)) fail(`${field}.${i}${suffix}`, `duplicate "${value}"`);
      seen.add(value);
    });
    return seen;
  }
  const checkId = (ids: ReadonlySet<string>, id: string, field: string, kind: string) => {
    if (!ids.has(id)) fail(field, `unknown ${kind} "${id}"`);
  };
  const byId = ({ id }: { id: string }) => id;
  const locations = unique(door.locations, 'locations', byId, '.id');
  const items = unique(door.items, 'items', byId, '.id');
  const flags = unique(door.flags, 'flags', (flag) => flag);
  const endings = unique(door.endings, 'endings', byId, '.id');
  unique(door.orderPuzzles, 'orderPuzzles', byId, '.id');
  const localAtoms = new Set([
    ...Array.from(items, (id) => `read:${id}`),
    ...Array.from(flags, (id) => `flag:${id}`),
    ...Array.from(endings, (id) => `completed:${id}`),
  ]);

  function checkLocalCondition(condition: Condition | undefined, field: string): void {
    if (condition === undefined) return;
    if (typeof condition === 'string') checkId(localAtoms, condition, field, 'local fact');
    else if ('not' in condition) checkLocalCondition(condition.not, `${field}.not`);
    else if ('all' in condition) {
      condition.all.forEach((child, i) => checkLocalCondition(child, `${field}.all.${i}`));
    } else {
      condition.any.forEach((child, i) => checkLocalCondition(child, `${field}.any.${i}`));
    }
  }

  checkId(locations, door.startLocationId, 'startLocationId', 'location');
  const operationsByPuzzle = new Map<string, Set<string>>();
  door.orderPuzzles.forEach((puzzle, i) => {
    const field = `orderPuzzles.${i}`;
    checkId(flags, puzzle.successFlag, `${field}.successFlag`, 'flag');
    puzzle.requiredItemIds.forEach((id, j) =>
      checkId(items, id, `${field}.requiredItemIds.${j}`, 'item'),
    );
    operationsByPuzzle.set(
      puzzle.id,
      unique(puzzle.operations, `${field}.operations`, byId, '.id'),
    );
    puzzle.operations.forEach((operation, j) => {
      operation.inputs.forEach(({ token }, k) => {
        if (
          !puzzle.operations.some((entry) => entry !== operation && entry.outputs.includes(token))
        ) {
          fail(
            `${field}.operations.${j}.inputs.${k}.token`,
            `no other operation produces "${token}"`,
          );
        }
      });
    });
  });

  door.locations.forEach(({ actions }, i) => {
    const field = `locations.${i}.actions`;
    unique(actions, field, ({ command }) => normalizeAdventureCommand(command), '.command');
    actions.forEach((action, j) => {
      const path = `${field}.${j}`;
      if (normalizeAdventureCommand(action.command) === 'EXIT')
        fail(`${path}.command`, 'EXIT is reserved by the door host');
      checkLocalCondition(action.when, `${path}.when`);
      switch (action.kind) {
        case 'move':
          checkId(locations, action.toLocationId, `${path}.toLocationId`, 'location');
          break;
        case 'inspect':
          checkId(items, action.itemId, `${path}.itemId`, 'item');
          break;
        case 'talk':
          if (action.variants.at(-1)?.when !== undefined) {
            fail(
              `${path}.variants.${action.variants.length - 1}.when`,
              'last dialogue variant must be unconditional',
            );
          }
          action.variants.forEach(({ when }, k) =>
            checkLocalCondition(when, `${path}.variants.${k}.when`),
          );
          break;
        case 'order': {
          const operations = operationsByPuzzle.get(action.puzzleId);
          if (!operations) {
            fail(`${path}.puzzleId`, `unknown order puzzle "${action.puzzleId}"`);
            break;
          }
          const submitted = unique(action.operationIds, `${path}.operationIds`, (id) => id);
          action.operationIds.forEach((id, k) =>
            checkId(operations, id, `${path}.operationIds.${k}`, 'operation'),
          );
          for (const id of operations) {
            if (!submitted.has(id)) fail(`${path}.operationIds`, `missing operation "${id}"`);
          }
          break;
        }
        case 'end':
          checkId(endings, action.endingId, `${path}.endingId`, 'ending');
          break;
      }
    });
  });

  const declared = new Set(door.rewards);
  const ruled = new Set(door.rewardRules.map(({ reward }) => reward));
  door.rewardRules.forEach(({ reward, when }, i) => {
    checkId(declared, reward, `rewardRules.${i}.reward`, 'declared reward');
    checkLocalCondition(when, `rewardRules.${i}.when`);
  });
  door.rewards.forEach((reward, i) => {
    if (!ruled.has(reward)) fail(`rewards.${i}`, `no reward rule for "${reward}"`);
  });

  if (invalid) return;
  const states = reachableAdventureStates(door);
  if (!states) {
    report('locations', `adventure exceeds ${ADVENTURE_STATE_LIMIT} reachable states`);
    return;
  }
  const visited = new Set(states.map(({ locationId }) => locationId));
  door.locations.forEach(({ id }, i) => {
    if (!visited.has(id)) report(`locations.${i}.id`, `unreachable location "${id}"`);
  });
}

type Report = (field: string, message: string) => void;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function createFactReferences() {
  return {
    ids: new Map<keyof Content, Set<string>>(),
    messages: new Set<string>(),
    granted: new Set<string>(),
  };
}

type FactReferences = ReturnType<typeof createFactReferences>;

function addFlagGrants(references: FactReferences, value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const fact of value) {
    if (typeof fact === 'string' && fact.startsWith('flag:')) references.granted.add(fact);
  }
}

/** Read only fields that can supply a saved-fact reference. */
function indexFactRecord(
  references: FactReferences,
  kind: keyof Content | 'doorMetadata',
  value: unknown,
): void {
  const record = asRecord(value);
  if (!record) return;
  const id = doorMetadataSchema.shape.id.safeParse(record.id);
  if (!id.success) return;

  switch (kind) {
    case 'episodes':
    case 'puzzles':
    case 'sectors':
    case 'transmissions':
    case 'archives':
    case 'accessLevels': {
      const ids = references.ids.get(kind) ?? new Set<string>();
      ids.add(id.data);
      references.ids.set(kind, ids);
      break;
    }
    case 'bbs':
      if (record.kind === 'message') references.messages.add(id.data);
      break;
    case 'community':
      for (const member of ['transmissions', 'archives'] as const) {
        const entries = record[member];
        if (Array.isArray(entries)) {
          for (const entry of entries) indexFactRecord(references, member, entry);
        }
      }
      break;
    case 'events':
      if (Array.isArray(record.effects)) {
        for (const value of record.effects) {
          const effect = asRecord(value);
          if (effect?.kind === 'grant-flag' && typeof effect.flag === 'string') {
            references.granted.add(`flag:${effect.flag}`);
          }
        }
      }
      break;
  }

  switch (kind) {
    case 'episodes':
    case 'puzzles':
      addFlagGrants(references, record.grants);
      break;
    case 'sectors':
      addFlagGrants(references, record.grantsOnEnter);
      break;
    case 'artifacts':
      addFlagGrants(references, record.grantsOnOpen);
      break;
    case 'doors':
      if (record.kind === 'adventure' || record.kind === 'trivia') {
        addFlagGrants(references, record.rewards);
      }
      break;
    case 'doorMetadata':
      addFlagGrants(references, record.rewards);
      break;
  }
}

function factError(references: FactReferences, fact: string, isGrant: boolean): string | undefined {
  const [head, name] = fact.split(':') as [FactPrefix, string];
  const kind = FACT_KINDS[head];
  if (kind === null) {
    if (!isGrant && !references.granted.has(fact)) return `nothing grants "${fact}"`;
  } else if (head === 'bbs-read') {
    if (!references.messages.has(name)) return `unknown BBS message "${name}"`;
  } else if (!references.ids.get(kind)?.has(name)) {
    return `unknown fact "${fact}": no ${kind} record has id "${name}"`;
  }
}

function checkDoorFacts(door: DoorMetadata, references: FactReferences, report: Report): void {
  for (const fact of factsIn(door.requires)) {
    const message = factError(references, fact, false);
    if (message) report('requires', message);
  }
  door.rewards.forEach((fact, index) => {
    const message = factError(references, fact, true);
    if (message) report(`rewards.${index}`, message);
  });
}

function checkReferences(
  content: Content,
  doors: readonly DoorMetadata[],
  sources: Sources,
  errors: ContentError[],
): void {
  const references = createFactReferences();
  for (const kind of Object.keys(content) as (keyof Content)[]) {
    if (kind === 'community' || kind === 'doors') continue;
    for (const record of content[kind]) indexFactRecord(references, kind, record);
  }
  for (const door of doors) indexFactRecord(references, 'doorMetadata', door);
  const { ids } = references;
  const messages = new Map(
    content.bbs.filter((entry) => entry.kind === 'message').map((entry) => [entry.id, entry]),
  );

  const checkFact = (fact: string, record: object, field: string, isGrant: boolean): void => {
    const { file, prefix } = sources.get(record)!;
    const message = factError(references, fact, isGrant);
    if (message) errors.push({ file, field: prefix + field, message });
  };
  const checkCondition = (condition: Condition | undefined, record: object, field: string) => {
    factsIn(condition).forEach((f) => checkFact(f, record, field, false));
  };

  const ranks = new Set<number>();
  for (const level of content.accessLevels) {
    const { file } = sources.get(level)!;
    if (ranks.has(level.rank)) {
      errors.push({ file, field: 'rank', message: `duplicate access level rank ${level.rank}` });
    }
    ranks.add(level.rank);
    checkCondition(level.when, level, 'when');
  }
  const firstLevel = content.accessLevels[0];
  if (firstLevel && !ranks.has(0)) {
    errors.push({
      file: sources.get(firstLevel)!.file,
      field: 'rank',
      message: 'access levels need an unconditional rank 0',
    });
  }

  for (const event of content.events) {
    const { file } = sources.get(event)!;
    checkCondition(event.when, event, 'when');
    event.effects.forEach((effect, i) => {
      if (effect.kind !== 'post-bulletin') return;
      const message = messages.get(effect.messageId);
      if (!message?.eventOnly) {
        errors.push({
          file,
          field: `effects.${i}.messageId`,
          message: message
            ? 'bulletin message must set eventOnly'
            : `unknown BBS message "${effect.messageId}"`,
        });
      }
    });
  }
  checkEventCycles(content.events, (event, cycle) => {
    errors.push({
      file: sources.get(event)!.file,
      field: 'when',
      message: `event dependency cycle: ${cycle.join(' -> ')}`,
    });
  });

  for (const episode of content.episodes) {
    episode.puzzles.forEach((puzzle, i) => {
      if (!ids.get('puzzles')?.has(puzzle)) {
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
  for (const door of doors) {
    const { file, prefix } = sources.get(door)!;
    checkDoorFacts(door, references, (field, message) =>
      errors.push({ file, field: prefix + field, message }),
    );
  }
  for (const door of content.doors) {
    if (door.kind === 'adventure') {
      checkAdventureReferences(door, (field, message) => {
        errors.push({ file: sources.get(door)!.file, field, message });
      });
    }
  }
  for (const record of [...content.transmissions, ...content.archives, ...content.artifacts]) {
    checkCondition(record.requires, record, 'requires');
  }
  checkBbsReferences(content, (entry, field, message) => {
    errors.push({ file: sources.get(entry)!.file, field, message });
  });
  for (const entry of content.bbs) {
    const { file } = sources.get(entry)!;
    if (entry.kind === 'board' || entry.kind === 'message-board') {
      checkCondition(entry.requires, entry, 'requires');
    }
    if (entry.kind === 'message-board') {
      entry.orderCheck?.prerequisites.forEach(({ fact }, i) =>
        checkFact(fact, entry, `orderCheck.prerequisites.${i}.fact`, false),
      );
    }
    if (
      entry.kind === 'message-board' &&
      entry.access &&
      !ids.get('accessLevels')?.has(entry.access.level)
    ) {
      errors.push({
        file,
        field: 'access.level',
        message: `unknown access level "${entry.access.level}"`,
      });
    }
    if (entry.kind !== 'board') continue;
    entry.status.forEach(({ when }, i) => checkCondition(when, entry, `status.${i}.when`));
    entry.archiveIds.forEach((id, index) => {
      if (!ids.get('archives')?.has(id)) {
        errors.push({ file, field: `archiveIds.${index}`, message: `unknown archive "${id}"` });
      }
    });
  }
  for (const artifact of content.artifacts) {
    artifact.grantsOnOpen.forEach((g, i) => checkFact(g, artifact, `grantsOnOpen.${i}`, true));
  }
  const lineSources = new Map<string, string>();
  for (const character of content.characters) {
    const { file } = sources.get(character)!;
    character.lines.forEach((line, i) => {
      const first = lineSources.get(line.id);
      if (first) {
        errors.push({
          file,
          field: `lines.${i}.id`,
          message: `duplicate dialogue line id "${line.id}" (first defined in ${first})`,
        });
      } else {
        lineSources.set(line.id, file);
      }
      checkCondition(line.when, character, `lines.${i}.when`);
      if (line.failures && !ids.get('puzzles')?.has(line.failures.puzzle)) {
        errors.push({
          file,
          field: `lines.${i}.failures.puzzle`,
          message: `unknown puzzle "${line.failures.puzzle}"`,
        });
      }
    });
  }
  for (const sector of content.sectors) {
    checkCondition(sector.visibleWhen, sector, 'visibleWhen');
    checkCondition(sector.enterableWhen, sector, 'enterableWhen');
    sector.grantsOnEnter.forEach((g, i) => checkFact(g, sector, `grantsOnEnter.${i}`, true));
    if (sector.puzzle && !ids.get('puzzles')?.has(sector.puzzle)) {
      const { file } = sources.get(sector)!;
      errors.push({ file, field: 'puzzle', message: `unknown puzzle "${sector.puzzle}"` });
    }
  }
  for (const capability of content.capabilities) {
    const { file } = sources.get(capability)!;
    checkFact(capability.fact, capability, 'fact', false);
    capability.context.forEach((fact, index) =>
      checkFact(fact, capability, `context.${index}`, false),
    );
    if (capability.context.includes(capability.fact)) {
      errors.push({
        file,
        field: 'context',
        message: 'context cannot contain its capability fact',
      });
      continue;
    }
    checkCapabilityEffect(content, capability, (message) => {
      errors.push({ file, field: 'target', message });
    });
  }
}

export function formatErrors(errors: ContentError[]): string {
  return errors.map((e) => `${e.file}: ${e.field}: ${e.message}`).join('\n');
}
