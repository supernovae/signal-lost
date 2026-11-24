import { z } from 'zod';
import type { SaveData } from '../progress/save.ts';

const id = z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/);
const readKey = z.string().regex(/^(archive|message):[a-z0-9]+([.-][a-z0-9]+)*$/);
const HISTORY_LIMIT = 100;
const historyEntry = z.discriminatedUnion('kind', [
  z.object({ kind: z.enum(['sign-in', 'directory', 'doors', 'network', 'disconnect']) }),
  z.object({ kind: z.enum(['board', 'thread', 'profile', 'door', 'secret']), id }),
  z.object({ kind: z.literal('read'), id: readKey }),
  z.object({ kind: z.literal('reply'), id, choice: id }),
]);

function recoverList<T>(schema: z.ZodType<T>) {
  return z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const result = schema.safeParse(entry);
        return result.success ? [result.data] : [];
      }),
    );
}

export const bbsProgressSchema = z
  .object({
    replies: z
      .record(z.string(), z.unknown())
      .catch({})
      .default({})
      .transform((replies) =>
        Object.fromEntries(
          Object.entries(replies).filter(
            (entry): entry is [string, string] =>
              id.safeParse(entry[0]).success && id.safeParse(entry[1]).success,
          ),
        ),
      ),
    discoveries: recoverList(id).transform((entries) => [...new Set(entries)]),
    history: recoverList(historyEntry).transform((entries) => entries.slice(-HISTORY_LIMIT)),
  })
  .catch({ replies: {}, discoveries: [], history: [] })
  .prefault({});

export type BbsHistoryEntry = z.infer<typeof historyEntry>;
export type BbsSnapshot = Pick<SaveData, 'bbs' | 'bbsReadMessages'> & {
  profile: Pick<SaveData['profile'], 'designation' | 'handle'>;
};

export interface BbsEffect {
  history: BbsHistoryEntry;
  handle?: string;
  readKeys?: readonly string[];
  reply?: { thread: string; choice: string };
  discovery?: string;
}

export function applyBbsEffect(data: SaveData, effect: BbsEffect): void {
  if (effect.handle !== undefined) data.profile.handle = effect.handle;
  if (effect.readKeys?.length) {
    data.bbsReadMessages = [...new Set([...data.bbsReadMessages, ...effect.readKeys])];
  }
  if (effect.reply) data.bbs.replies[effect.reply.thread] = effect.reply.choice;
  if (effect.discovery && !data.bbs.discoveries.includes(effect.discovery)) {
    data.bbs.discoveries.push(effect.discovery);
  }
  data.bbs.history = [...data.bbs.history, effect.history].slice(-HISTORY_LIMIT);
}
