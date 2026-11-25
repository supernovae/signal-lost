import { projectEntryContent, type EntryContent } from './browser-split.ts';
import { parseDoorContent, repairManifestPath } from './repair-manifest.ts';
import type { Content } from './schema.ts';
import { formatErrors, loadContent, parseContentJson } from './validate.ts';

const modules = import.meta.glob('/content/**/*.json', { eager: true, import: 'default' });
const manifests = import.meta.glob<string>('/content/code-doors/manifest-r07-spool-02.jsonc', {
  eager: true,
  query: '?raw',
  import: 'default',
});

/** Loads and validates authored JSON in development. Vite supplies validated content in builds. */
export function loadBundledContent(): Content {
  const path = `/${repairManifestPath}`;
  const result = loadContent({
    ...modules,
    [path]: parseContentJson(manifests[path]!, parseDoorContent),
  });
  if (result.errors.length > 0) throw new Error(formatErrors(result.errors));
  return result.content;
}

export function loadBundledEntryContent(): EntryContent {
  return projectEntryContent(loadBundledContent());
}
