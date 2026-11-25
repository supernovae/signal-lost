import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures.ts';
import { seedSaveOnce } from './helpers.ts';

const deferredRequestPath =
  /\/(?:connection-[^/]+\.js|contributors?-[^/]+\.(?:js|json)|signal-hunter-[^/]+\.js|relay-trader-[^/]+\.js|code-door-content-[^/]+\.js|content\/.*\.json|[^/]+\.jsonc|content-manifest\.json)$/;

for (const completed of [false, true]) {
  test(`${completed ? 'completed save' : 'fresh'} startup makes no failed, off-site, or deferred requests`, async ({
    page,
    baseURL,
  }) => {
    if (completed) {
      await seedSaveOnce(
        page,
        readFileSync(new URL('../fixtures/episode-000-complete-v1.json', import.meta.url), 'utf8'),
      );
    }
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    const eagerRequests: string[] = [];
    page.on('requestfailed', (request) => problems.push(`failed: ${request.url()}`));
    page.on('response', (response) => {
      if (!response.ok()) problems.push(`${response.status()}: ${response.url()}`);
    });
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (deferredRequestPath.test(url.pathname)) {
        eagerRequests.push(url.pathname);
      }
      if (url.protocol.startsWith('http') && url.origin !== origin) {
        problems.push(`off-site: ${request.url()}`);
      }
    });
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => problems.push(`error: ${error.message}`));

    await page.goto('./');
    await expect(page.getByRole('log')).toContainText('PRESS ENTER TO JOIN THE NETWORK');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log')).toContainText('OBSERVER NETWORK CLIENT');
    await expect(page.getByRole('button', { name: /\] CONNECT$/ })).toHaveCount(completed ? 1 : 0);
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
    expect(eagerRequests).toEqual([]);
  });
}
