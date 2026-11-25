import { z } from 'zod';
import type { DoorMetadata } from '../content/schema.ts';

const json = z.json();
const definedDoor = Symbol('definedDoor');
export type DoorPayload = z.infer<typeof json>;

/** A snapshot of facts at the start of a lifecycle call. */
export interface DoorProgress {
  readonly hasFact: (fact: string) => boolean;
}

/** Text and commands for the shared BBS terminal. EXIT belongs to the host. */
export interface DoorScreen {
  readonly lines: readonly string[];
  readonly actions: readonly { command: string; label: string }[];
}

interface DoorStep<State> {
  state: State;
  screen: DoorScreen;
}

/** Callbacks are synchronous. Working state is local to the visit, and saved JSON to the ID. */
export type DoorDefinition<State, Saved extends DoorPayload> = {
  saveState: z.ZodType<Saved>;
  launch(progress: DoorProgress): DoorStep<State>;
  restore(saved: Saved, progress: DoorProgress): DoorStep<State>;
  input(state: State, command: string, progress: DoorProgress): DoorStep<State>;
  exit(state: State, progress: DoorProgress): undefined;
  save(state: State, progress: DoorProgress): Saved;
} & (
  | {
      /** The host applies all registered rewards when this returns true. */
      isComplete(saved: Saved, progress: DoorProgress): boolean;
      earnedRewards?: never;
    }
  | {
      isComplete?: never;
      earnedRewards(saved: Saved, progress: DoorProgress): readonly string[];
    }
);

type DoorCheckpoint = { payload: DoorPayload } & (
  | { complete: boolean; earnedRewards?: never }
  | { complete?: never; earnedRewards: readonly string[] }
);

export interface RunningDoor {
  readonly screen: DoorScreen;
  input(command: string, progress: DoorProgress): DoorScreen;
  exit(progress: DoorProgress): void;
  checkpoint(progress: DoorProgress): DoorCheckpoint;
}

export interface DoorLifecycle {
  readonly [definedDoor]: true;
  launch(progress: DoorProgress): RunningDoor;
  /** An invalid payload starts a fresh visit. Exceptions fail the visit. */
  restore(payload: DoorPayload, progress: DoorProgress): RunningDoor | undefined;
}

/** Adapt typed working and saved state to the common registry interface. */
export function defineDoor<State, Saved extends DoorPayload>(
  definition: DoorDefinition<State, Saved>,
): DoorLifecycle {
  function start(step: DoorStep<State>): RunningDoor {
    let { state } = step;
    return {
      screen: step.screen,
      input(command, progress) {
        const next = definition.input(state, command, progress);
        state = next.state;
        return next.screen;
      },
      exit(progress) {
        definition.exit(state, progress);
      },
      checkpoint(progress) {
        const saved = definition.saveState.parse(json.parse(definition.save(state, progress)));
        const payload = json.parse(saved);
        return definition.earnedRewards
          ? { payload, earnedRewards: definition.earnedRewards(saved, progress) }
          : { payload, complete: definition.isComplete(saved, progress) };
      },
    };
  }

  return {
    [definedDoor]: true,
    launch: (progress) => start(definition.launch(progress)),
    restore(payload, progress) {
      const saved = definition.saveState.safeParse(structuredClone(payload));
      return saved.success ? start(definition.restore(saved.data, progress)) : undefined;
    },
  };
}

/** Metadata is available at startup. The literal import loads reviewed code on selection. */
export interface CodeDoorRegistration {
  source: string;
  metadata: DoorMetadata;
  load(): Promise<{ default: DoorLifecycle }>;
}
