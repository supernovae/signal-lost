import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';
import { freshSave } from '../../src/progress/save.ts';
import { completeEpisode } from './helpers.ts';

const SAVE_KEY = 'signal-lost.save';
const resetNotice = 'Your saved progress could not be loaded and was reset.';

async function seedSaveOnce(page: Page, value: string): Promise<void> {
  await page.addInitScript(
    ({ key, text }) => {
      const marker = 'progress-test-save-seeded';
      if (sessionStorage.getItem(marker)) return;
      localStorage.setItem(key, text);
      sessionStorage.setItem(marker, '1');
    },
    { key: SAVE_KEY, text: value },
  );
}

async function join(page: Page): Promise<void> {
  await page.goto('./');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('OBSERVER NETWORK CLIENT');
}

async function lockCarrier(page: Page): Promise<void> {
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await page.getByLabel('TUNE').fill('200');
  await page.getByLabel('DRIFT', { exact: true }).fill('-0.42');
  await page.getByLabel('BANDWIDTH').selectOption('5');
  await page.getByRole('button', { name: 'LOCK' }).click();
  await expect(page.getByRole('log')).toContainText('CARRIER LOCKED');
}

test('a solved puzzle survives a reload, and ECHO reacts and remembers', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Enter');
  const log = page.getByRole('log');

  await page.getByRole('button', { name: /ECHO/ }).click();
  await expect(log).toContainText("ECHO: Bright doesn't mean far");

  await lockCarrier(page);
  await expect(log).toContainText('I have been listening to that');

  await page.reload();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await expect(page.getByRole('log')).toContainText('CARRIER LOCKED');
  await expect(page.getByLabel('TUNE')).toBeHidden();
  await expect(page.getByRole('log')).not.toContainText('I have been listening');
});

test('an invalid save produces one notice and the new save remains playable', async ({ page }) => {
  await seedSaveOnce(page, '{ corrupt');
  await join(page);
  const notice = page
    .getByRole('log')
    .locator('p')
    .and(page.getByText(resetNotice, { exact: true }));
  await expect(notice).toHaveCount(1);

  await completeEpisode(page);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  await expect(page.getByLabel('OBS>')).toBeVisible();
  await expect(notice).toHaveCount(0);

  await page.reload();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('OBSERVER NETWORK CLIENT');
  await expect(notice).toHaveCount(0);
});

test('a newer save survives progress, settings changes, reset and reload', async ({ page }) => {
  const original = ' { "schemaVersion": 99, "extra": {"keep":true} }\n';
  await seedSaveOnce(page, original);
  await join(page);
  const log = page.getByRole('log');
  const saved = () => page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect(await saved()).toBe(original);
  await expect(log).not.toContainText(resetNotice);

  await lockCarrier(page);
  await expect(page.getByRole('button', { name: /DECODER/ })).toBeVisible();
  expect(await saved()).toBe(original);

  await page.getByRole('button', { name: /SETTINGS/ }).click();
  const mute = page.getByLabel('SOUND MUTED');
  await mute.check();
  await expect(mute).toBeChecked();
  expect(await saved()).toBe(original);

  await page.getByRole('button', { name: 'RESET PROGRESS' }).click();
  await page.getByRole('button', { name: 'CONFIRM RESET' }).click();
  await expect(page.getByRole('button', { name: 'CONFIRM RESET' })).toBeHidden();
  await expect(page.getByLabel('OBS>')).toBeFocused();
  await expect(page.getByRole('button', { name: /DECODER/ })).toBeVisible();
  expect(await saved()).toBe(original);

  await page.reload();
  await page.keyboard.press('Enter');
  await expect(log).toContainText('OBSERVER NETWORK CLIENT');
  await expect(log).not.toContainText(resetNotice);
  expect(await saved()).toBe(original);
});

test('STATUS prints the normalized profile as text', async ({ page }) => {
  const data = freshSave(42);
  data.profile = {
    ...data.profile,
    handle: '  <b>Relay</b>  ',
    designation: 'OBS-0001',
    accessLevel: 'MAINTAINER',
  };
  await seedSaveOnce(page, JSON.stringify(data));
  await join(page);
  await page.getByRole('button', { name: /STATUS/ }).click();
  const log = page.getByRole('log');
  const handle = log.getByText('HANDLE: <b>Relay</b>', { exact: true });
  await expect(handle).toBeVisible();
  expect(await handle.textContent()).toBe('HANDLE: <b>Relay</b>');
  await expect(log.getByText('ACCESS LEVEL: MAINTAINER', { exact: true })).toBeVisible();
  await expect(log.getByText('DESIGNATION: OBS-0001', { exact: true })).toBeVisible();
  await expect(log.getByText('LINK: ONE-WAY', { exact: true })).toBeVisible();
  await expect(log.locator('b')).toHaveCount(0);
});

test('STATUS omits unset profile fields on a fresh join', async ({ page }) => {
  await join(page);
  await page.getByRole('button', { name: /STATUS/ }).click();
  const log = page.getByRole('log');
  await expect(log.getByText('LINK: ONE-WAY', { exact: true })).toBeVisible();
  await expect(log).not.toContainText(/HANDLE:|ACCESS LEVEL:/);
});
