import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseDoorContent, repairManifestPath } from './repair-manifest.ts';
import { JsonParseFailure, parseContentJson } from './validate.ts';

/** Reads authored JSON and the shared repair manifest, keyed by their content paths. */
export function readContentDir(root: string): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const key = `content/${relative(root, path).split('\\').join('/')}`;
    if (!entry.name.endsWith('.json') && key !== repairManifestPath) continue;
    try {
      files[key] = parseContentJson(
        readFileSync(path, 'utf8'),
        key === repairManifestPath ? parseDoorContent : JSON.parse,
      );
    } catch (error) {
      files[key] = new JsonParseFailure((error as Error).message);
    }
  }
  return files;
}
