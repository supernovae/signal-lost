import { projectBbsContent, type BbsContent } from './browser-split.ts';
import { loadBundledContent } from './browser.ts';

/** Production builds replace this module with the validated BBS projection. */
export function loadBundledBbsContent(): BbsContent {
  return projectBbsContent(loadBundledContent());
}
