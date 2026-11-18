import { z } from 'zod';

export const SAVE_SCHEMA_VERSION = 2;
const SAVE_KEY = 'signal-lost.save';
export const HANDLE_MAX_CODE_POINTS = 32;

const preferencesSchema = z.object({
  muted: z.boolean(),
  reducedMotion: z.boolean().nullable(),
  effects: z.boolean(),
});

const progressFields = {
  puzzles: z.array(z.string()),
  transmissions: z.array(z.string()),
  archives: z.array(z.string()),
  locations: z.array(z.string()),
  episodes: z.array(z.string()),
  flags: z.array(z.string()),
  seenLines: z.array(z.string()),
  failures: z.record(z.string(), z.number().int().nonnegative()),
} as const;

const profileSchema = z.object({
  /** A fictional local name. Optional, trimmed and bounded before storage. */
  handle: z.string().nullable(),
  designation: z.string().nullable(),
  /** A label for the access rules that come later; no rule reads it yet. */
  accessLevel: z.string().nullable(),
  /** The per-save seed for deterministic, repeatable anomalies. */
  seed: z.number().int().nonnegative(),
});

/** The version 2 core. Door state is recovered per slot, outside this schema. */
const coreSaveSchema = z.object({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  ...progressFields,
  preferences: preferencesSchema,
  profile: profileSchema,
});

/** The shape the version 1 writer produced, with the designation at the top level. */
const legacySaveSchema = z.object({
  schemaVersion: z.literal(1),
  ...progressFields,
  preferences: preferencesSchema,
  designation: z.string().nullable(),
});

/** Version 0 is the version 1 shape before preferences existed. */
const legacyPreferencesFreeSchema = z.object({
  schemaVersion: z.literal(0),
  ...progressFields,
  designation: z.string().nullable(),
});

export type SaveData = z.infer<typeof coreSaveSchema> & { doorState: Record<string, unknown> };
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveStatus = 'new' | 'loaded' | 'migrated' | 'reset' | 'unsupported';

export const DEFAULT_PREFERENCES: SaveData['preferences'] = {
  muted: false,
  // null follows the browser's prefers-reduced-motion setting.
  reducedMotion: null,
  effects: true,
};

const defaultSeedSource = (): number => crypto.getRandomValues(new Uint32Array(1))[0]!;

export interface SaveOptions {
  /** Draws the per-save seed. Injected in tests; defaults to one crypto draw. */
  seedSource?(): number;
}

export interface SaveSession {
  readonly data: SaveData;
  readonly status: SaveStatus;
  /**
   * Stores the current data. Returns false when this session is locked, a newer
   * save has appeared in storage, or the browser refuses the write.
   */
  persist(): boolean;
  /**
   * Removes the save. Returns false when this session is locked or the browser
   * refuses the removal. The data stays playable in memory either way.
   */
  clear(): boolean;
}

export function freshSave(seed: number = defaultSeedSource()): SaveData {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    puzzles: [],
    transmissions: [],
    archives: [],
    locations: [],
    episodes: [],
    flags: [],
    seenLines: [],
    failures: {},
    preferences: { ...DEFAULT_PREFERENCES },
    profile: { handle: null, designation: null, accessLevel: null, seed: seed >>> 0 },
    doorState: Object.create(null) as Record<string, unknown>,
  };
}

/** A fictional local name: trimmed, bounded by code points, and never required. */
function normalizeHandle(handle: string | null): string | null {
  if (typeof handle !== 'string') return null;
  const trimmed = handle.trim();
  if (trimmed.length === 0) return null;
  return Array.from(trimmed).slice(0, HANDLE_MAX_CODE_POINTS).join('');
}

/** A door slot is opaque: any JSON value that round-trips. Non-finite numbers do not. */
function isJsonValue(value: unknown, seen: Set<object>): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      const object = value as object;
      // JSON.parse cannot produce a cycle; the guard covers hand-built values.
      if (seen.has(object)) return true;
      seen.add(object);
      return Object.values(object).every((item) => isJsonValue(item, seen));
    }
    default:
      return false;
  }
}

/**
 * Recovers each door slot independently. One damaged slot is dropped; a missing
 * or malformed map becomes an empty map. Never fails, never touches prototypes.
 */
function recoverDoorState(value: unknown): Record<string, unknown> {
  const doors = Object.create(null) as Record<string, unknown>;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return doors;
  for (const [door, slot] of Object.entries(value)) {
    try {
      if (isJsonValue(slot, new Set())) doors[door] = slot;
    } catch {
      // A slot that cannot even be checked is dropped, not the whole save.
    }
  }
  return doors;
}

/** Upgrades from an older schema version to the current one, step by step. */
const MIGRATIONS: Record<
  number,
  (old: Record<string, unknown>, nextSeed: () => number) => Record<string, unknown>
> = {
  // Version 0 had no preferences.
  0: (old) => ({ ...old, schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES } }),
  // Version 1 kept the designation at the top level; version 2 moves it into
  // the profile, keeps its exact value, and adds the profile seed and doors.
  1: (old, nextSeed) => ({
    ...old,
    schemaVersion: 2,
    profile: {
      handle: null,
      designation: old['designation'] ?? null,
      accessLevel: null,
      seed: nextSeed() >>> 0,
    },
    doorState: {},
  }),
};

function migrate(
  raw: Record<string, unknown>,
  nextSeed: () => number,
): Record<string, unknown> | undefined {
  let current = raw;
  while (current['schemaVersion'] !== SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[current['schemaVersion'] as number];
    if (!step) return undefined;
    current = step(current, nextSeed);
  }
  return current;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
    return raw as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readVersion(raw: Record<string, unknown>): number | undefined {
  const version = raw['schemaVersion'];
  return typeof version === 'number' && Number.isInteger(version) ? version : undefined;
}

/** True when the text holds a save this client is too old to understand. */
function isNewerSave(text: string | null): boolean {
  const raw = text === null ? undefined : parseJson(text);
  if (raw === undefined) return false;
  const version = readVersion(raw);
  return version !== undefined && version > SAVE_SCHEMA_VERSION;
}

function session(
  storage: SaveStorage,
  data: SaveData,
  status: SaveStatus,
  locked: boolean,
): SaveSession {
  /** Refuses to touch storage once a newer save is known to be there. */
  const blocked = (): boolean => {
    if (locked) return true;
    let current: string | null;
    try {
      current = storage.getItem(SAVE_KEY);
    } catch {
      return false; // An unreadable store cannot reveal a newer save.
    }
    if (isNewerSave(current)) {
      locked = true; // Latched: this session never writes over a newer save.
      return true;
    }
    return false;
  };

  return {
    data,
    status,
    persist() {
      if (blocked()) return false;
      data.profile.handle = normalizeHandle(data.profile.handle);
      try {
        storage.setItem(SAVE_KEY, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      if (blocked()) return false;
      try {
        storage.removeItem(SAVE_KEY);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function loadSave(storage: SaveStorage, options: SaveOptions = {}): SaveSession {
  const nextSeed = options.seedSource ?? defaultSeedSource;

  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return session(storage, freshSave(nextSeed()), 'new', false);
  }
  if (text === null) return session(storage, freshSave(nextSeed()), 'new', false);

  const raw = parseJson(text);
  if (raw === undefined) return session(storage, freshSave(nextSeed()), 'reset', false);

  const version = readVersion(raw);
  // A save from a newer client stays in storage untouched: this session plays on
  // fresh in-memory progress and never writes back over it.
  if (version !== undefined && version > SAVE_SCHEMA_VERSION) {
    return session(storage, freshSave(nextSeed()), 'unsupported', true);
  }

  const migrated = version !== SAVE_SCHEMA_VERSION;
  if (migrated) {
    // Validate the legacy core in its own shape before building its profile.
    const legacy = version === 0 ? legacyPreferencesFreeSchema : legacySaveSchema;
    if (!legacy.safeParse(raw).success) {
      return session(storage, freshSave(nextSeed()), 'reset', false);
    }
  }

  const upgraded = migrated ? migrate(raw, nextSeed) : raw;
  if (upgraded === undefined) return session(storage, freshSave(nextSeed()), 'reset', false);

  const parsed = coreSaveSchema.safeParse(upgraded);
  if (!parsed.success) return session(storage, freshSave(nextSeed()), 'reset', false);

  const data: SaveData = {
    ...parsed.data,
    profile: { ...parsed.data.profile, handle: normalizeHandle(parsed.data.profile.handle) },
    doorState: recoverDoorState(upgraded['doorState']),
  };
  const save = session(storage, data, migrated ? 'migrated' : 'loaded', false);
  // A successful migration replaces the older bytes immediately.
  if (migrated) save.persist();
  return save;
}

const FACT_FIELDS = {
  solved: 'puzzles',
  acquired: 'transmissions',
  read: 'archives',
  discovered: 'locations',
  completed: 'episodes',
  flag: 'flags',
} as const;

export function factsOf(data: SaveData): Set<string> {
  const facts = new Set<string>();
  for (const [prefix, field] of Object.entries(FACT_FIELDS)) {
    for (const id of data[field]) facts.add(`${prefix}:${id}`);
  }
  return facts;
}

export function addFact(data: SaveData, fact: string): void {
  const [prefix, id] = fact.split(':') as [keyof typeof FACT_FIELDS, string];
  const list = data[FACT_FIELDS[prefix]];
  if (!list.includes(id)) list.push(id);
}
