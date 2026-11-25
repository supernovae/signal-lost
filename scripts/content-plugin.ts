import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { readContentDir } from '../src/content/node.ts';
import { formatErrors, loadContent, type LoadResult } from '../src/content/validate.ts';

/** Validates authored content and supplies it to the production entry and manifest. */
export function contentPlugin(root = resolve(import.meta.dirname, '../content')): Plugin {
  const browserModule = normalizePath(resolve(import.meta.dirname, '../src/content/browser.ts'));
  let result: LoadResult;
  let contentPaths: string[];

  return {
    name: 'signal-lost-content',
    apply: 'build',
    buildStart() {
      const files = readContentDir(root);
      result = loadContent(files);
      if (result.errors.length > 0) this.error(`Invalid content:\n${formatErrors(result.errors)}`);
      contentPaths = Object.keys(files);
    },
    load(id) {
      if (id !== browserModule) return;
      for (const path of contentPaths)
        this.addWatchFile(resolve(root, path.slice('content/'.length)));
      const payload = JSON.stringify(JSON.stringify(result.content));
      return `export function loadBundledContent() { return JSON.parse(${payload}); }`;
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'content-manifest.json',
        source: `${JSON.stringify(result.manifest, null, 2)}\n`,
      });
    },
  };
}
