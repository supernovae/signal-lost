import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { buildContributorRecord, type ContributorRecord } from '../src/content/contributors.ts';
import { readContentDir } from '../src/content/node.ts';
import { formatErrors, loadContent, type LoadResult } from '../src/content/validate.ts';

/** Validates authored content for the production entry, credits and manifest. */
export function contentPlugin(root = resolve(import.meta.dirname, '../content')): Plugin {
  const browserModule = normalizePath(resolve(import.meta.dirname, '../src/content/browser.ts'));
  const contributorsModule = normalizePath(
    resolve(import.meta.dirname, '../src/content/contributors-browser.ts'),
  );
  let result: LoadResult;
  let contributors: ContributorRecord;
  let contentPaths: string[];

  return {
    name: 'signal-lost-content',
    apply: 'build',
    buildStart() {
      const files = readContentDir(root);
      result = loadContent(files);
      if (result.errors.length > 0) this.error(`Invalid content:\n${formatErrors(result.errors)}`);
      contributors = buildContributorRecord(result.content);
      contentPaths = Object.keys(files);
    },
    load(id) {
      if (id !== browserModule && id !== contributorsModule) return;
      for (const path of contentPaths)
        this.addWatchFile(resolve(root, path.slice('content/'.length)));
      const [name, data] =
        id === browserModule
          ? ['loadBundledContent', result.content]
          : ['loadBundledContributors', contributors];
      const payload = JSON.stringify(JSON.stringify(data));
      return `export function ${name}() { return JSON.parse(${payload}); }`;
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
