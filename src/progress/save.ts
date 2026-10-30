import { z } from 'zod';

export const SAVE_SCHEMA_VERSION = 1;
const SAVE_KEY = 'signal-lost.save';

const preferencesSchema = z.object({
  muted: z.boolean(),
  reducedMotion: z.boolean().nullable(),
  effects: z.boolean(),
});

const saveSchema = z.object({
  schemaVersion: z.literal(SAVE_SCHEMA_VERSION),
  puzzles: z.array(z.string()),
  transmissions: z.array(z.string()),
  archives: z.array(z.string()),
  locations: z.array(z.string()),
  episodes: z.array(z.string()),
  flags: z.array(z.string()),
  seenLines: z.array(z.string()),
  failures: z.record(z.string(), z.number().int().nonnegative()),
  preferences: preferencesSchema,
  designation: z.string().nullable(),
});

export type SaveData = z.infer<typeof saveSchema>;
export type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SaveStatus = 'new' | 'loaded' | 'migrated' | 'reset';

export const DEFAULT_PREFERENCES: SaveData['preferences'] = {
  muted: false,
  // null follows the browser's prefers-reduced-motion setting.
  reducedMotion: null,
  effects: true,
};

export function freshSave(): SaveData {
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
    designation: null,
  };
}

/** Upgrades from an older schema version to the next. Version 0 had no preferences. */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  0: (old) => ({ ...old, schemaVersion: 1, preferences: { ...DEFAULT_PREFERENCES } }),
};

function migrate(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  let current = raw;
  while (current['schemaVersion'] !== SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[current['schemaVersion'] as number];
    if (!step) return undefined;
    current = step(current);
  }
  return current;
}

export function loadSave(storage: SaveStorage): { data: SaveData; status: SaveStatus } {
  let text: string | null;
  try {
    text = storage.getItem(SAVE_KEY);
  } catch {
    return { data: freshSave(), status: 'new' };
  }
  if (text === null) return { data: freshSave(), status: 'new' };
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const upgraded = migrate(raw);
    const parsed = saveSchema.safeParse(upgraded);
    if (!parsed.success) return { data: freshSave(), status: 'reset' };
    const status = raw['schemaVersion'] === SAVE_SCHEMA_VERSION ? 'loaded' : 'migrated';
    return { data: parsed.data, status };
  } catch {
    return { data: freshSave(), status: 'reset' };
  }
}

/** Returns false when the browser refuses the write. Play continues either way. */
export function writeSave(storage: SaveStorage, data: SaveData): boolean {
  try {
    storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function resetSave(storage: SaveStorage): SaveData {
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // Nothing else to clear: the fresh save still applies to this session.
  }
  return freshSave();
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
