import type { Archive } from '../content/schema.ts';

const normalize = (text: string): string => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * An empty query browses the ordinary boards. `searchOnly` records answer only to
 * an exact keyword. Callers pass archives already filtered by their `requires`.
 */
export function searchArchives(archives: readonly Archive[], query: string): Archive[] {
  const wanted = normalize(query);
  if (!wanted) return archives.filter((archive) => !archive.searchOnly);
  return archives.filter((archive) => {
    const keywords = archive.keywords.map(normalize);
    if (archive.searchOnly) return keywords.includes(wanted);
    const fields = [archive.title, archive.from, archive.board, ...keywords].map(normalize);
    return fields.some((field) => field.includes(wanted));
  });
}
