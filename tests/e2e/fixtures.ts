import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { test as base } from '@playwright/test';

const SITE_PREFIX = '/signal-lost/';
const DIST = join(import.meta.dirname, '../../dist');
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Serves dist/ only under the Pages subpath and answers 404 elsewhere, as Pages
// does, so a root-relative asset URL fails the test.
export const test = base.extend({
  context: async ({ context }, use) => {
    // SIGNAL_LOST_LIVE=1 runs the same specs against the deployed site.
    if (process.env['SIGNAL_LOST_LIVE']) {
      await use(context);
      return;
    }
    await context.route('**/*', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (!pathname.startsWith(SITE_PREFIX)) return route.fulfill({ status: 404 });
      const relative = pathname.slice(SITE_PREFIX.length) || 'index.html';
      try {
        const body = await readFile(join(DIST, normalize(relative)));
        const contentType = CONTENT_TYPES[extname(relative)] ?? 'application/octet-stream';
        return await route.fulfill({ status: 200, body, contentType });
      } catch {
        return route.fulfill({ status: 404 });
      }
    });
    await use(context);
  },
});

export { expect } from '@playwright/test';
