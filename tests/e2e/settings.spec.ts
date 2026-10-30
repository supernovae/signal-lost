import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

const SAVE_KEY = 'signal-lost.save';

async function join(page: Page): Promise<void> {
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('OBSERVER NETWORK CLIENT');
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: /SETTINGS/ }).click();
}

/** Screenshots of the live 3D view, taken a moment apart. */
async function viewscreenChanges(page: Page): Promise<boolean> {
  const view = page.locator('#viewscreen');
  await expect(view).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-render', 'webgl');
  // Only the canvas counts: text and scanline overlays animate on their own.
  const overlays = await page.addStyleTag({
    content: '#app, .interference, .effects { visibility: hidden !important; }',
  });
  const first = await view.screenshot();
  await page.waitForTimeout(1000);
  const second = await view.screenshot();
  await overlays.evaluate((element) => element.remove());
  return !first.equals(second);
}

test('audio waits for a gesture, and mute persists', async ({ page }) => {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    (window as unknown as { audioContexts: number }).audioContexts = 0;
    window.AudioContext = class extends Original {
      constructor() {
        super();
        (window as unknown as { audioContexts: number }).audioContexts++;
      }
    };
  });
  const contexts = () =>
    page.evaluate(() => (window as unknown as { audioContexts: number }).audioContexts);

  await page.goto('./');
  await expect(page.getByRole('log')).toContainText('SIGNAL RECEIVED');
  expect(await contexts()).toBe(0);
  await join(page);
  expect(await contexts()).toBe(1);

  await openSettings(page);
  await page.getByLabel('SOUND MUTED').check();
  const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(JSON.parse(saved!).preferences.muted).toBe(true);

  await page.reload();
  await join(page);
  await openSettings(page);
  await expect(page.getByLabel('SOUND MUTED')).toBeChecked();
});

test.describe('motion', () => {
  test('runs by default', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('body')).toHaveAttribute('data-motion', 'on');
    expect(await viewscreenChanges(page)).toBe(true);
  });

  test('stops under the system reduced-motion preference', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('./');
    await expect(page.locator('body')).toHaveAttribute('data-motion', 'off');
    await expect(page.locator('.interference')).toBeHidden();
    expect(await viewscreenChanges(page)).toBe(false);
  });

  test('stops with the setting, and stays stopped after a reload', async ({ page }) => {
    await page.goto('./');
    await join(page);
    await openSettings(page);
    await page.getByLabel('REDUCE MOTION').check();
    await page.getByRole('button', { name: 'CLOSE' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-motion', 'off');
    await expect(page.locator('.interference')).toBeHidden();
    expect(await viewscreenChanges(page)).toBe(false);

    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-motion', 'off');
    expect(await viewscreenChanges(page)).toBe(false);
    await join(page);
    await openSettings(page);
    await expect(page.getByLabel('REDUCE MOTION')).toBeChecked();
  });
});

test('screen effects can be disabled without affecting the text', async ({ page }) => {
  await page.goto('./');
  await join(page);
  const text = page.getByRole('log').locator('p').first();
  const style = () =>
    text.evaluate((element) => {
      const { color, fontSize } = getComputedStyle(element);
      return { color, fontSize };
    });
  const before = await style();
  await expect(page.locator('.effects')).toBeVisible();

  await openSettings(page);
  await page.getByLabel('SCREEN EFFECTS').uncheck();
  await expect(page.locator('.effects')).toBeHidden();
  await expect(page.locator('.interference')).toBeHidden();
  expect(await style()).toEqual(before);

  await page.reload();
  await expect(page.locator('.effects')).toBeHidden();
  await expect(page.locator('.interference')).toBeHidden();
});

test('settings work from the keyboard, and reset asks first', async ({ page }) => {
  await page.goto('./');
  await join(page);
  const log = page.getByRole('log');

  // A saved solve, so reset has something to clear.
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await page.getByLabel('TUNE').fill('200');
  await page.getByLabel('DRIFT', { exact: true }).fill('-0.42');
  await page.getByLabel('BANDWIDTH').selectOption('5');
  await page.getByRole('button', { name: 'LOCK' }).click();
  await expect(log).toContainText('CARRIER LOCKED');

  const puzzles = async () => {
    const saved = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
    return saved ? (JSON.parse(saved).puzzles as string[]) : [];
  };

  await page.getByLabel('OBS>').fill('SETTINGS');
  await page.keyboard.press('Enter');
  await page.getByLabel('SOUND MUTED').focus();
  await page.keyboard.press('Space');
  await expect(page.getByLabel('SOUND MUTED')).toBeChecked();

  await page.getByRole('button', { name: 'RESET PROGRESS' }).focus();
  await page.keyboard.press('Enter');
  expect(await puzzles()).toEqual(['puzzle.carrier']);
  await expect(page.getByRole('button', { name: 'KEEP PROGRESS' })).toBeFocused();
  await page.keyboard.press('Enter');
  expect(await puzzles()).toEqual(['puzzle.carrier']);

  await page.getByRole('button', { name: 'RESET PROGRESS' }).click();
  await page.getByRole('button', { name: 'CONFIRM RESET' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('SIGNAL RECEIVED');
  expect(await puzzles()).toEqual([]);
});
