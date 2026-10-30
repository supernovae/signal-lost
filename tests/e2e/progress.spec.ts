import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

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

test('a corrupt save does not stop the game', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('signal-lost.save', '{ corrupt'));
  await page.goto('./');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('log')).toContainText('OBSERVER NETWORK CLIENT');
  await lockCarrier(page);
});
