import { z } from 'zod';
import { evaluate } from '../content/conditions.ts';
import type { AdventureDoor } from '../content/schema.ts';
import { defineDoor } from './contract.ts';

const checkpoint = z.strictObject({
  locationId: z.string(),
  inspectedItemIds: z.array(z.string()),
  flags: z.array(z.string()),
  endingId: z.string().nullable(),
});

type AdventureState = z.infer<typeof checkpoint>;
type AdventureAction = AdventureDoor['locations'][number]['actions'][number];
type OrderPuzzle = AdventureDoor['orderPuzzles'][number];

export const ADVENTURE_STATE_LIMIT = 4096;

export function normalizeAdventureCommand(command: string): string {
  return command
    .replace(/\s+/g, ' ')
    .replace(/\s*\/\s*/g, ' / ')
    .trim()
    .toUpperCase();
}

export function initialAdventureState(door: AdventureDoor): AdventureState {
  return { locationId: door.startLocationId, inspectedItemIds: [], flags: [], endingId: null };
}

function localFacts({ inspectedItemIds, flags, endingId }: AdventureState): Set<string> {
  const facts = new Set([
    ...inspectedItemIds.map((id) => `read:${id}`),
    ...flags.map((id) => `flag:${id}`),
  ]);
  if (endingId !== null) facts.add(`completed:${endingId}`);
  return facts;
}

function locationOf(door: AdventureDoor, state: AdventureState) {
  return door.locations.find(({ id }) => id === state.locationId)!;
}

export function availableAdventureActions(
  door: AdventureDoor,
  state: AdventureState,
): AdventureAction[] {
  const facts = localFacts(state);
  return locationOf(door, state).actions.filter(
    (action) => (action.kind !== 'end' || state.endingId === null) && evaluate(action.when, facts),
  );
}

function sortedUnique(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}

function hasRequiredItems(state: AdventureState, puzzle: OrderPuzzle): boolean {
  return puzzle.requiredItemIds.every((id) => state.inspectedItemIds.includes(id));
}

function submitOrder(
  door: AdventureDoor,
  state: AdventureState,
  action: Extract<AdventureAction, { kind: 'order' }>,
) {
  const puzzle = door.orderPuzzles.find(({ id }) => id === action.puzzleId)!;
  const produced = new Set<string>();
  for (const id of action.operationIds) {
    const operation = puzzle.operations.find((entry) => entry.id === id)!;
    const missing = operation.inputs.find(({ token }) => !produced.has(token));
    if (missing) return { state, feedback: missing.missing };
    operation.outputs.forEach((token) => produced.add(token));
  }
  if (!hasRequiredItems(state, puzzle)) return { state, feedback: puzzle.inspectFirst };
  return {
    state: { ...state, flags: sortedUnique([...state.flags, puzzle.successFlag]) },
    feedback: puzzle.success,
  };
}

export function stepAdventure(door: AdventureDoor, state: AdventureState, command: string) {
  const key = normalizeAdventureCommand(command);
  const action = availableAdventureActions(door, state).find(
    (entry) => normalizeAdventureCommand(entry.command) === key,
  );
  return action
    ? applyAction(door, state, action)
    : { state, feedback: ['Unknown or unavailable action.'] };
}

function applyAction(door: AdventureDoor, state: AdventureState, action: AdventureAction) {
  switch (action.kind) {
    case 'move':
      return { state: { ...state, locationId: action.toLocationId }, feedback: [] };
    case 'inspect':
      return {
        state: {
          ...state,
          inspectedItemIds: sortedUnique([...state.inspectedItemIds, action.itemId]),
        },
        feedback: door.items.find(({ id }) => id === action.itemId)!.text,
      };
    case 'talk': {
      const facts = localFacts(state);
      return { state, feedback: action.variants.find(({ when }) => evaluate(when, facts))!.text };
    }
    case 'show':
      return { state, feedback: action.text };
    case 'order':
      return submitOrder(door, state, action);
    case 'end':
      return { state: { ...state, endingId: action.endingId }, feedback: [] };
  }
}

/** Traverse canonical checkpoints, excluding display-only feedback. */
export function reachableAdventureStates(door: AdventureDoor): AdventureState[] | undefined {
  const initial = initialAdventureState(door);
  const states = [initial];
  const seen = new Set([JSON.stringify(initial)]);
  for (const state of states) {
    for (const action of availableAdventureActions(door, state)) {
      const next = applyAction(door, state, action).state;
      const key = JSON.stringify(next);
      if (seen.has(key)) continue;
      if (states.length === ADVENTURE_STATE_LIMIT) return;
      seen.add(key);
      states.push(next);
    }
  }
  return states;
}

export function createAdventureDoor(door: AdventureDoor) {
  const saveState = checkpoint
    .refine(
      (state) =>
        door.locations.some(({ id }) => id === state.locationId) &&
        state.inspectedItemIds.every((id) => door.items.some((item) => item.id === id)) &&
        state.flags.every((flag) => {
          if (!door.flags.includes(flag)) return false;
          const puzzles = door.orderPuzzles.filter(({ successFlag }) => successFlag === flag);
          return !puzzles.length || puzzles.some((puzzle) => hasRequiredItems(state, puzzle));
        }) &&
        (state.endingId === null || door.endings.some(({ id }) => id === state.endingId)),
    )
    .transform((state) => ({
      ...state,
      inspectedItemIds: sortedUnique(state.inspectedItemIds),
      flags: sortedUnique(state.flags),
    }));

  function show(state: AdventureState, feedback: string[] = []) {
    const location = locationOf(door, state);
    const ending = door.endings.find(({ id }) => id === state.endingId);
    return {
      state,
      screen: {
        lines: [
          door.name,
          location.title,
          ...location.description,
          ...feedback,
          ...(ending?.text ?? []),
        ],
        actions: availableAdventureActions(door, state).map(({ command, label }) => ({
          command: normalizeAdventureCommand(command),
          label,
        })),
      },
    };
  }

  return defineDoor({
    saveState,
    launch: () => show(initialAdventureState(door)),
    restore: (state) => show(state),
    input(state, command) {
      const next = stepAdventure(door, state, command);
      return show(next.state, next.feedback);
    },
    exit() {},
    save: (state) => state,
    earnedRewards(state) {
      const facts = localFacts(state);
      return door.rewardRules
        .filter(({ when }) => evaluate(when, facts))
        .map(({ reward }) => reward);
    },
  });
}
