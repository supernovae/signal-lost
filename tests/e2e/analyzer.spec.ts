import { expect, test } from './fixtures.ts';

test('the player can reject a fixed line and lock the drifting carrier', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Enter');
  const log = page.getByRole('log');
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await expect(log).toContainText('SPECTRUM ANALYZER ONLINE');

  const waterfall = await page.getByRole('img', { name: /Waterfall/ }).screenshot();
  expect(new Set(waterfall).size).toBeGreaterThan(50);

  const tune = page.getByLabel('TUNE');
  const drift = page.getByLabel('DRIFT', { exact: true });
  const bandwidth = page.getByLabel('BANDWIDTH');
  const lock = page.getByRole('button', { name: 'LOCK' });

  // A bright fixed line scores well but is refused.
  await tune.fill('100');
  await bandwidth.selectOption('5');
  await lock.click();
  await expect(log).toContainText('THAT LINE DOES NOT MOVE');

  // The real line needs its drift cancelled, reached here by keyboard.
  await tune.fill('200');
  await drift.fill('-0.4');
  await drift.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('.analyzer-readout')).toContainText('DRIFT -0.42');
  await lock.click();
  await expect(log).toContainText('CARRIER LOCKED');
  await expect(page.getByLabel('TUNE')).toBeHidden();
});
