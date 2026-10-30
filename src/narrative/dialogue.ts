import { evaluate } from '../content/conditions.ts';
import type { Character, DialogueLine } from '../content/schema.ts';

export interface DialogueState {
  facts: ReadonlySet<string>;
  seen: ReadonlySet<string>;
  failures: Readonly<Record<string, number>>;
}

/**
 * Where a character's next line comes from. Scripted today. A model-backed source
 * could implement this later without touching progression, which never reads dialogue.
 */
export interface DialogueSource {
  next(kind: DialogueLine['kind'], state: DialogueState): DialogueLine | undefined;
}

export function createScriptedDialogue(character: Character): DialogueSource {
  return {
    next(kind, state) {
      let best: DialogueLine | undefined;
      for (const line of character.lines) {
        if (line.kind !== kind) continue;
        if (line.once && state.seen.has(line.id)) continue;
        if (!evaluate(line.when, state.facts)) continue;
        if (line.failures) {
          const count = state.failures[line.failures.puzzle] ?? 0;
          if (count < line.failures.atLeast) continue;
        }
        if (!best || line.priority > best.priority) best = line;
      }
      return best;
    },
  };
}
