import { resolve } from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { projectBbsContent, projectEntryContent } from '../src/content/browser-split.ts';
import { buildContributorRecord, type ContributorRecord } from '../src/content/contributors.ts';
import { readContentDir } from '../src/content/node.ts';
import { formatErrors, loadContent, type LoadResult } from '../src/content/validate.ts';

/** Validates authored content for the production entry, credits and manifest. */
export function contentPlugin(root = resolve(import.meta.dirname, '../content')): Plugin {
  const browserModule = normalizePath(resolve(import.meta.dirname, '../src/content/browser.ts'));
  const bbsModule = normalizePath(resolve(import.meta.dirname, '../src/content/bbs-browser.ts'));
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
      if (id !== browserModule && id !== bbsModule && id !== contributorsModule) return;
      for (const path of contentPaths)
        this.addWatchFile(resolve(root, path.slice('content/'.length)));
      if (id === bbsModule)
        return payloadExport('loadBundledBbsContent', projectBbsContent(result.content));
      if (id === contributorsModule) return payloadExport('loadBundledContributors', contributors);
      return [
        payloadExport('loadBundledContent', result.content),
        payloadExport('loadBundledEntryContent', projectEntryContent(result.content)),
      ].join('\n');
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

function payloadExport(name: string, data: unknown): string {
  return `export function ${name}() { return JSON.parse(${JSON.stringify(JSON.stringify(data))}); }`;
}
