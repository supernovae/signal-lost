import { z } from 'zod';

export const SAVE_SCHEMA_VERSION = 2;
const SAVE_KEY = 'signal-lost.save';

const preferencesSchema = z.object({
  muted: z.boolean(),
  reducedMotion: z.boolean().nullable(),
  effects: z.boolean(),
});

const globalSchema = z.object({
  puzzles: z.array(z.string()),
  transmissions: z.array(z.string()),
  archives: z.array(z.string()),
  locations: z.array(z.string()),
  episodes: z.array(z.string()),
  flags: z.array(z.string()),
  seenLines: z.array(z.string()),
  failures: z.record(z.string(), z.number().int().nonnegative()),
  preferences: preferencesSchema,
});

const legacySchema = globalSchema.extend({
  schemaVersion: z.literal(1),
  designation: z.string().nullable(),
});

export function normalizeHandle(handle: string | null): string | null {
  const trimmed = handle?.trim();
  return trimmed ? Array.from(trimmed).slice(0, 32).join('').trimEnd() : null;
}

const saveSchema = globalSchema.extend({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  bbsReadMessages: z
    .array(z.string())
    .catch([])
    .default([])
    .transform((keys) => [...new Set(keys)]),
  profile: z.object({
    handle: z.string().nullable().transform(normalizeHandle),
    designation: z.string().nullable(),
    accessLevel: z
      .string()
      .refine((level) => level.trim().length > 0)
      .nullable(),
    seed: z.number().int().min(0).max(0xffffffff),
  }),
});

const jsonSchema = z.json();
type DoorState = Record<string, z.infer<typeof jsonSchema>>;

export type SaveData = z.infer<typeof saveSchema> & { doorState: DoorState };
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export type SaveStatus = 'new' | 'loaded' | 'migrated' | 'reset' | 'unsupported';

export const DEFAULT_PREFERENCES: SaveData['preferences'] = {
  muted: false,
  // null follows the browser's prefers-reduced-motion setting.
  reducedMotion: null,
  effects: true,
};

function createSaveSeed(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
}

export function freshSave(seed = createSaveSeed()): SaveData {
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
    bbsReadMessages: [],
    profile: { handle: null, designation: null, accessLevel: null, seed },
    doorState: {},
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStored(text: string | null): unknown {
  try {
    return text === null ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isFutureSave(raw: unknown): boolean {
  if (!isObject(raw)) return false;
  const version = raw['schemaVersion'];
  return typeof version === 'number' && Number.isInteger(version) && version > SAVE_SCHEMA_VERSION;
}

function decodeDoorState(raw: unknown): DoorState {
  const slots: [string, DoorState[string]][] = [];
  if (!isObject(raw)) return {};
  for (const [id, text] of Object.entries(raw)) {
    if (typeof text !== 'string') continue;
    try {
      const decoded = parseStored(text);
      if (jsonSchema.safeParse(decoded).success) slots.push([id, decoded as DoorState[string]]);
    } catch {
      // A single slot may exceed the validator's recursion limit.
    }
  }
  return Object.fromEntries(slots);
}

function encodeDoorState(doors: DoorState): Record<string, string> {
  const slots: [string, string][] = [];
  if (!isObject(doors)) return {};
  for (const id of Object.keys(doors)) {
    try {
      const value = doors[id];
      if (!jsonSchema.safeParse(value).success) continue;
      const encoded = JSON.stringify(value);
      if (typeof encoded === 'string') slots.push([id, encoded]);
    } catch {
      // A slot can contain a circular or otherwise unserializable value at runtime.
    }
  }
  return Object.fromEntries(slots);
}

export function loadSave(
  storage: SaveStorage,
  seed: () => number = createSaveSeed,
): { data: SaveData; status: SaveStatus } {
  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    text = null;
  }

  if (text === null) return { data: freshSave(seed()), status: 'new' };
  const raw = parseStored(text);
  if (isFutureSave(raw)) return { data: freshSave(seed()), status: 'unsupported' };
  if (isObject(raw)) {
    const version = raw['schemaVersion'];
    if (version === 0 || version === 1) {
      // Version 0 had no preferences. Upgrade to the v1 shape before lifting to v2.
      const legacy = legacySchema.safeParse(
        version === 0 ? { ...raw, schemaVersion: 1, preferences: DEFAULT_PREFERENCES } : raw,
      );
      if (legacy.success) {
        const { designation, ...global } = legacy.data;
        const data: SaveData = {
          ...global,
          schemaVersion: SAVE_SCHEMA_VERSION,
          bbsReadMessages: [],
          profile: { handle: null, designation, accessLevel: null, seed: seed() },
          doorState: {},
        };
        return { data, status: 'migrated' };
      }
    } else {
      const parsed = saveSchema.safeParse(raw);
      if (parsed.success) {
        const data = { ...parsed.data, doorState: decodeDoorState(raw['doorState']) };
        return { data, status: 'loaded' };
      }
    }
  }
  return { data: freshSave(seed()), status: 'reset' };
}

function mutateSave(storage: SaveStorage, mutate: () => void): boolean {
  try {
    if (isFutureSave(parseStored(storage.getItem(SAVE_KEY)))) return false;
    mutate();
    return true;
  } catch {
    return false;
  }
}

/** Returns false when storage refuses the write or holds a newer save. */
export function writeSave(storage: SaveStorage, data: SaveData): boolean {
  return mutateSave(storage, () => {
    const { doorState, ...global } = data;
    const validated = saveSchema.parse(global);
    const encoded = { ...validated, doorState: encodeDoorState(doorState) };
    storage.setItem(SAVE_KEY, JSON.stringify(encoded));
  });
}

export function clearSave(storage: SaveStorage): boolean {
  return mutateSave(storage, () => storage.removeItem(SAVE_KEY));
}

export function openSaveSession(storage: SaveStorage, seed?: () => number) {
  const { data, status } = loadSave(storage, seed);
  const persist = (candidate: SaveData = data): boolean =>
    status !== 'unsupported' && writeSave(storage, candidate);
  const clear = (): boolean => status !== 'unsupported' && clearSave(storage);

  if (status === 'new' || status === 'migrated' || status === 'reset') persist();
  return { data, status, persist, clear };
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
