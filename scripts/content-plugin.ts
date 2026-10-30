import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { readContentDir } from '../src/content/node.ts';
import { formatErrors, loadContent } from '../src/content/validate.ts';

/** Fails the build on invalid content and emits the versioned content manifest. */
export function contentPlugin(root = resolve(import.meta.dirname, '../content')): Plugin {
  return {
    name: 'signal-lost-content',
    apply: 'build',
    generateBundle() {
      const { errors, manifest } = loadContent(readContentDir(root));
      if (errors.length > 0) this.error(`Invalid content:\n${formatErrors(errors)}`);
      this.emitFile({
        type: 'asset',
        fileName: 'content-manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}
