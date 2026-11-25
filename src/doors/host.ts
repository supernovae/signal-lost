import { z } from 'zod';
import { addFact, factsOf, type SaveData } from '../progress/save.ts';
import type { DoorProgress, DoorScreen, RunningDoor } from './contract.ts';
import type { DoorRegistry } from './registry.ts';

const slotSchema = z.strictObject({ version: z.number().int().positive(), payload: z.json() });
type Registration = NonNullable<ReturnType<DoorRegistry['find']>>;

export type DoorResult =
  | { kind: 'screen'; screen: DoorScreen }
  | { kind: 'exit'; returnTo: Registration['returnTo'] }
  | { kind: 'unavailable' }
  | { kind: 'failure' };

function progressView(facts: ReadonlySet<string>): DoorProgress {
  return Object.freeze({ hasFact: (fact: string) => facts.has(fact) });
}

function copyScreen(screen: DoorScreen): DoorResult {
  return {
    kind: 'screen',
    screen: {
      lines: [...screen.lines],
      actions: screen.actions.map(({ command, label }) => ({ command, label })),
    },
  };
}

export function createDoorHost(
  registry: DoorRegistry,
  data: SaveData,
  persist: (candidate: SaveData) => boolean,
  settle?: (candidate: SaveData) => void,
) {
  let active: { registration: Registration; door: RunningDoor } | undefined;
  let opening = false;

  function fail(): DoorResult {
    active = undefined;
    return { kind: 'failure' };
  }

  async function launch(id: string): Promise<DoorResult> {
    if (active || opening) return { kind: 'unavailable' };
    const registration = registry.find(id, factsOf(data));
    if (!registration) return { kind: 'unavailable' };
    opening = true;
    try {
      const { default: lifecycle } = await registration.load(data.profile.seed);
      const facts = factsOf(data);
      if (!registry.find(id, facts)) return { kind: 'unavailable' };
      const progress = progressView(facts);
      let restored: RunningDoor | undefined;
      if (Object.hasOwn(data.doorState, registration.id)) {
        const saved = slotSchema.safeParse(data.doorState[registration.id]);
        if (saved.success && saved.data.version === registration.version) {
          restored = lifecycle.restore(saved.data.payload, progress);
        }
      }
      const door = restored ?? lifecycle.launch(progress);
      const result = copyScreen(door.screen);
      active = { registration, door };
      return result;
    } catch {
      return fail();
    } finally {
      opening = false;
    }
  }

  function step(command: string | undefined): DoorResult {
    if (!active) return { kind: 'unavailable' };
    const { registration, door } = active;
    const progress = progressView(factsOf(data));
    try {
      let result: DoorResult;
      if (command === undefined) {
        door.exit(progress);
        result = { kind: 'exit', returnTo: registration.returnTo };
      } else {
        result = copyScreen(door.input(command, progress));
      }
      const { payload, complete, earnedRewards } = door.checkpoint(progress);
      const slot = slotSchema.parse({ version: registration.version, payload });
      const next: SaveData = {
        ...data,
        doorState: { ...data.doorState, [registration.id]: slot },
      };
      const declared = new Set(registration.rewards);
      const candidates = earnedRewards ?? (complete === true ? declared : []);
      const rewards = [...new Set(candidates)].filter(
        (fact) => declared.has(fact) && !progress.hasFact(fact),
      );
      if (rewards.length) {
        // Stage rewards on separate arrays until the slot and facts have been written together.
        next.puzzles = [...data.puzzles];
        next.transmissions = [...data.transmissions];
        next.archives = [...data.archives];
        next.locations = [...data.locations];
        next.episodes = [...data.episodes];
        next.flags = [...data.flags];
        rewards.forEach((fact) => addFact(next, fact));
        settle?.(next);
      }
      if (!persist(next)) return fail();
      Object.assign(data, next);
      if (result.kind === 'exit') active = undefined;
      return result;
    } catch {
      return fail();
    }
  }

  return {
    list: () => registry.list(factsOf(data)),
    facts: () => factsOf(data),
    launch,
    input: (command: string) => step(command),
    exit: () => step(undefined),
  };
}

export type DoorHost = ReturnType<typeof createDoorHost>;
