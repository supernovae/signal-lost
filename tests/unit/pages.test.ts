import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config.ts';

describe('GitHub Pages subpath', () => {
  it('configures the project base', () => {
    expect(config).toMatchObject({ base: '/signal-lost/' });
  });

  it('builds index.html with assets under the project base', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'signal-lost-pages-'));
    try {
      await build({ logLevel: 'silent', build: { outDir, emptyOutDir: true } });
      const html = await readFile(join(outDir, 'index.html'), 'utf8');
      expect(html).toMatch(/src="\/signal-lost\/assets\/[^"]+\.js"/);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
