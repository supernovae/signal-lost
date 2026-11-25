import type { DoorSelection } from '../content/validate.ts';
import { freshSave } from '../progress/save.ts';
import { createDoorHost } from './host.ts';
import { createDoorRegistry } from './registry.ts';

/** Launches a validated door with detached progress and its entry gate open. */
export function createDoorAuthoringHost(selection: DoorSelection) {
  const requires = { all: [] };
  const registry =
    selection.kind === 'declarative'
      ? createDoorRegistry([{ ...selection.door, requires }], [])
      : createDoorRegistry(
          [],
          [
            {
              ...selection.registration,
              metadata: { ...selection.registration.metadata, requires },
            },
          ],
        );
  return createDoorHost(registry, freshSave(42), () => true);
}
