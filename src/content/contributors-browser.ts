import { loadBundledContent } from './browser.ts';
import { buildContributorRecord, type ContributorRecord } from './contributors.ts';

/** Vite replaces this development path with the reviewed record in production. */
export function loadBundledContributors(): ContributorRecord {
  return buildContributorRecord(loadBundledContent());
}
