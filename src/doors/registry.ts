import { evaluate } from '../content/conditions.ts';
import { doorMetadataSchema, type DeclarativeDoor, type DoorMetadata } from '../content/schema.ts';
import { createAdventureDoor } from './adventure.ts';
import { CODE_DOORS } from './code-doors.ts';
import type { CodeDoorRegistration } from './contract.ts';
import { createTriviaDoor } from './trivia.ts';

export type DoorListing = Pick<DoorMetadata, 'id' | 'name' | 'description'>;

export function createDoorRegistry(
  declarative: readonly DeclarativeDoor[],
  codeDoors: readonly CodeDoorRegistration[] = CODE_DOORS,
) {
  const entries = new Map<string, Omit<CodeDoorRegistration, 'source'>>();

  function register(metadata: DoorMetadata, load: CodeDoorRegistration['load']): void {
    if (entries.has(metadata.id)) throw new Error(`duplicate door id "${metadata.id}"`);
    entries.set(metadata.id, { metadata, load });
  }

  for (const record of declarative) {
    const door = structuredClone(record);
    register(door, async () => ({
      default: door.kind === 'adventure' ? createAdventureDoor(door) : createTriviaDoor(door),
    }));
  }
  for (const { metadata, load } of codeDoors) register(doorMetadataSchema.parse(metadata), load);

  return {
    list(facts: ReadonlySet<string>): DoorListing[] {
      return [...entries.values()]
        .filter(({ metadata }) => evaluate(metadata.requires, facts))
        .map(({ metadata: { id, name, description } }) => ({ id, name, description }));
    },
    find(id: string, facts: ReadonlySet<string>) {
      const entry = entries.get(id);
      if (!entry || !evaluate(entry.metadata.requires, facts)) return;
      const { version, rewards, returnTo } = entry.metadata;
      return { id, version, rewards: [...rewards], returnTo, load: entry.load };
    },
  };
}

export type DoorRegistry = ReturnType<typeof createDoorRegistry>;
