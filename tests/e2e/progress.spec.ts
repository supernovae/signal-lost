import { expect, test } from './fixtures.ts';
import { completeEpisode } from './helpers.ts';
import type { Page } from '@playwright/test';

const SAVE_KEY = 'signal-lost.save';
const RESET_NOTICE = 'YOUR SAVED PROGRESS COULD NOT BE LOADED AND WAS RESET.';

/** Seeds storage once per case: an init script alone would re-seed on reload. */
async function seedSave(page: Page, blob: string): Promise<void> {
  await page.addInitScript((value) => {
    if (localStorage.getItem('signal-lost.save') === null) {
      localStorage.setItem('signal-lost.save', value);
    }
  }, blob);
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

test('a corrupt save does not stop the game: it resets once, with one visible notice', async ({
  page,
}) => {
  await seedSave(page, '{ corrupt');
  await page.goto('./');
  await page.keyboard.press('Enter');
  const log = page.getByRole('log');
  await expect(log).toContainText('OBSERVER NETWORK CLIENT');
  await expect(log.getByText(RESET_NOTICE)).toHaveCount(1);

  // The whole episode is playable on the recovered progress.
  await completeEpisode(page);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  await expect(log).toContainText('OBSERVER NETWORK CLIENT');
  // A later hub entry gets the normal boot lines, never a second notice.
  await expect(log.getByText(RESET_NOTICE)).toHaveCount(0);

  // The replacement save is stored, and loads normally across a reload.
  const raw = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  expect((JSON.parse(raw!) as { schemaVersion: number }).schemaVersion).toBe(2);
  await page.reload();
  await page.keyboard.press('Enter');
  await expect(log.getByText(RESET_NOTICE)).toHaveCount(0);
  await page.getByRole('button', { name: /STATUS/ }).click();
  await expect(log).toContainText(/DESIGNATION: OBS-[0-9A-F]{4}/);
  await page.getByRole('button', { name: /INQUIRY/ }).click();
  await expect(log).toContainText('ALL FIELDS CONSISTENT');
});

test('a save from a newer client stays untouched while this session plays on', async ({ page }) => {
  const future = '  { "schemaVersion" : 99, "note" : "unknown", "doors" : { "a": 1 } }  ';
  await seedSave(page, future);
  await page.goto('./');
  await page.keyboard.press('Enter');
  const log = page.getByRole('log');
  await expect(log).toContainText('OBSERVER NETWORK CLIENT');
  await expect(log.getByText(RESET_NOTICE)).toHaveCount(0);
  const raw = (): Promise<string | null> =>
    page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);

  // The game plays in memory; every mutation path leaves the stored bytes alone.
  await lockCarrier(page);
  expect(await raw()).toBe(future);

  await page.getByRole('button', { name: /SETTINGS/ }).click();
  await page.getByLabel('REDUCE MOTION').check();
  await expect(page.locator('body')).toHaveAttribute('data-motion', 'off');
  expect(await raw()).toBe(future);

  // A confirmed reset is a silent no-op: no reload, the stored bytes stay.
  await page.getByRole('button', { name: 'RESET PROGRESS' }).click();
  await page.getByRole('button', { name: 'CONFIRM RESET' }).click();
  await expect(log).toContainText('CARRIER LOCKED');
  expect(await raw()).toBe(future);
});

test('STATUS shows the profile fields that are set, as plain text', async ({ page }) => {
  const save = {
    schemaVersion: 2,
    puzzles: [],
    transmissions: [],
    archives: [],
    locations: [],
    episodes: [],
    flags: [],
    seenLines: [],
    failures: {},
    preferences: { muted: false, reducedMotion: null, effects: true },
    profile: {
      handle: '  <b>Keel</b>  ',
      designation: 'OBS-0007',
      accessLevel: 'FIELD',
      seed: 7,
    },
    doorState: {},
  };
  await seedSave(page, JSON.stringify(save));
  await page.goto('./');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /STATUS/ }).click();
  const log = page.getByRole('log');
  const handle = log.getByText('HANDLE: <b>Keel</b>', { exact: true });
  await expect(handle).toBeVisible();
  await expect(handle.locator('b')).toHaveCount(0);
  await expect(log).toContainText('ACCESS LEVEL: FIELD');
  await expect(log).toContainText('DESIGNATION: OBS-0007');
  await expect(log).toContainText('LINK: ONE-WAY');
  await expect(log).toContainText('OBSERVERS ONLINE: 1');
});

test('STATUS hides the profile fields that are not set', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /STATUS/ }).click();
  const log = page.getByRole('log');
  await expect(log.getByText(/^HANDLE:/)).toHaveCount(0);
  await expect(log.getByText(/^ACCESS LEVEL:/)).toHaveCount(0);
  await expect(log.getByText(/^DESIGNATION:/)).toHaveCount(0);
  await expect(log).toContainText('LINK: ONE-WAY');
  await expect(log).toContainText('OBSERVERS ONLINE: 1');
});
