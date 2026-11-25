import type { Artifact, Attribution, Content } from './schema.ts';

type Identity = Pick<Attribution, 'author' | 'handle'>;
type ContributorCopy = NonNullable<Artifact['contributorRecord']>;
type ContributorStatus = 'empty' | 'maintainers-only' | 'contributors';

export interface ContributorEntry extends Identity {
  sourcePrs: string[];
}

export interface ContributorRecord {
  entries: ContributorEntry[];
  status: ContributorStatus;
}

const identityKey = ({ author, handle }: Identity) => JSON.stringify([author, handle]);

export function selectContributorStatus(
  entries: readonly Identity[],
  declaredMaintainers: readonly Identity[],
): ContributorStatus {
  if (!entries.length) return 'empty';
  const maintainers = new Set(declaredMaintainers.map(identityKey));
  return entries.every((entry) => maintainers.has(identityKey(entry)))
    ? 'maintainers-only'
    : 'contributors';
}

export function selectContributorNote(status: ContributorStatus, copy: ContributorCopy) {
  if (status === 'empty') return copy.empty;
  if (status === 'maintainers-only') return copy.maintainersOnly;
}

export function buildContributorRecord(content: Content): ContributorRecord {
  const groups: readonly (readonly { attribution?: Attribution }[])[] = Object.values(content);
  const credits = new Map<string, { identity: Identity; sourcePrs: Set<string> }>();
  const maintainers: Identity[] = [];

  // The loader already flattens package entries and resolves their inherited credit.
  for (const group of groups) {
    for (const { attribution } of group) {
      if (!attribution || attribution.creditKind === 'placeholder') continue;
      const { author, handle, sourcePr, creditKind } = attribution;
      const identity = handle === undefined ? { author } : { author, handle };
      const key = identityKey(identity);
      let credit = credits.get(key);
      if (!credit) {
        credit = { identity, sourcePrs: new Set() };
        credits.set(key, credit);
      }
      if (sourcePr !== undefined) credit.sourcePrs.add(sourcePr);
      if (creditKind === 'maintainer') maintainers.push(identity);
    }
  }

  const entries = [...credits.keys()].sort().map((key) => {
    const { identity, sourcePrs } = credits.get(key)!;
    return { ...identity, sourcePrs: [...sourcePrs].sort() };
  });
  return { entries, status: selectContributorStatus(entries, maintainers) };
}
