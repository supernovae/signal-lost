import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test } from './fixtures.ts';

const ASSETS = join(import.meta.dirname, '../../dist/assets');
const gzippedKb = (prefix: string): number => {
  const file = readdirSync(ASSETS).find((name) => name.startsWith(prefix) && name.endsWith('.js'));
  expect(file, prefix).toBeDefined();
  return gzipSync(readFileSync(join(ASSETS, file!))).length / 1024;
};

test('the bundle stays within budget', () => {
  expect(gzippedKb('index-')).toBeLessThanOrEqual(60);
  expect(gzippedKb('environment-')).toBeLessThanOrEqual(170);
});

// A floor measured on a CPU rasterizer in CI, not a measurement on real graphics hardware.
test('the application renders at least 10 frames a second on software WebGL', async ({ page }) => {
  await page.addInitScript(() => {
    const prototype = WebGL2RenderingContext.prototype;
    const clear = prototype.clear;
    (window as unknown as { rendered: number }).rendered = 0;
    prototype.clear = function (this: WebGL2RenderingContext, mask: number) {
      (window as unknown as { rendered: number }).rendered++;
      return clear.call(this, mask);
    };
  });
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-render', 'webgl');
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'on');
  expect(await page.evaluate(() => document.hidden)).toBe(false);

  const rendered = () => page.evaluate(() => (window as unknown as { rendered: number }).rendered);
  const before = await rendered();
  await page.waitForTimeout(2000);
  expect((await rendered()) - before).toBeGreaterThanOrEqual(20);
});
