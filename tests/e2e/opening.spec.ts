import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const OPENING = [
  'SIGNAL RECEIVED',
  'ORIGIN: UNKNOWN',
  'CLASSIFICATION: UNRESOLVED',
  'CONFIDENCE: 0.0031%',
  'ADDITIONAL OBSERVERS REQUIRED.',
  'PRESS ENTER TO JOIN THE NETWORK',
];

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function expectUsableTerminal(page: Page): Promise<void> {
  const log = page.getByRole('log');
  await expect(log).toHaveAttribute('aria-live', 'polite');
  await expect(log).toContainText('OBSERVER NETWORK CLIENT');
  await expect(page.getByLabel('OBS>')).toBeFocused();

  await page.getByRole('button', { name: /STATUS/ }).click();
  await expect(log).toContainText('LINK: ONE-WAY');

  await page.getByLabel('OBS>').fill('2');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('TYPE A TOOL NUMBER');

  await page.getByLabel('OBS>').fill('nonsense');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('UNKNOWN COMMAND');
}

test('the opening plays over a rendered scene and Enter joins the network', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-render', 'webgl');
  const log = page.getByRole('log');
  await expect(log).toContainText('PRESS ENTER TO JOIN THE NETWORK');
  const text = await log.innerText();
  const positions = OPENING.map((line) => text.indexOf(line));
  expect(positions.every((position) => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));

  await expect(page.locator('.interference')).toBeAttached();
  await expect(page.locator('#viewscreen')).toBeVisible();
  const sample = await page.locator('#viewscreen').screenshot();
  expect(new Set(sample).size).toBeGreaterThan(50);

  await page.keyboard.press('Enter');
  await expectUsableTerminal(page);
  expect(errors).toEqual([]);
});

test('a click joins the network, even before the text has finished', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Join the network' }).click();
  await expectUsableTerminal(page);
});

test('the game stays playable when WebGL is unavailable', async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
      if (type.includes('webgl')) return null;
      return original.call(this, type as '2d');
    } as typeof original;
  });
  await page.goto('./');
  await expect(page.locator('body')).toHaveAttribute('data-render', 'fallback');
  await expect(page.locator('.crt')).toHaveCSS('background-image', /radial-gradient/);
  await expect(page.getByRole('log')).toContainText('SIGNAL RECEIVED');
  await page.keyboard.press('Enter');
  await expectUsableTerminal(page);
  expect(errors).toEqual([]);
});
