import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { JsonParseFailure } from './validate.ts';

/** Reads every JSON file below `root`, keyed by a `content/...` path. */
export function readContentDir(root: string): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const path = join(entry.parentPath, entry.name);
    const key = `content/${relative(root, path).split('\\').join('/')}`;
    try {
      files[key] = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      files[key] = new JsonParseFailure((error as Error).message);
    }
  }
  return files;
}
