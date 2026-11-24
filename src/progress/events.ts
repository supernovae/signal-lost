import { evaluate } from '../content/conditions.ts';
import type { NetworkEvent } from '../content/schema.ts';
import { factsOf, type SaveData } from './save.ts';

/** Settles a candidate before its caller persists the fact change and all effects together. */
export function settleEvents(events: readonly NetworkEvent[], candidate: SaveData): string[] {
  const firedNow: string[] = [];
  const ordered = [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const facts = factsOf(candidate);
  const fired = new Set(candidate.events.fired);
  const bulletins = new Set(candidate.events.bulletins);
  const newFlags: string[] = [];

  while (true) {
    const event = ordered.find(({ id, when }) => !fired.has(id) && evaluate(when, facts));
    if (!event) break;
    for (const effect of event.effects) {
      if (effect.kind === 'grant-flag') {
        const fact = `flag:${effect.flag}`;
        if (!facts.has(fact)) newFlags.push(effect.flag);
        facts.add(fact);
      } else {
        bulletins.add(effect.messageId);
      }
    }
    fired.add(event.id);
    firedNow.push(event.id);
  }

  if (firedNow.length) {
    if (newFlags.length) candidate.flags = [...candidate.flags, ...newFlags];
    candidate.events = { fired: [...fired], bulletins: [...bulletins] };
  }
  return firedNow;
}
