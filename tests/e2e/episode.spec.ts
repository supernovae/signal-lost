import { expect, test } from './fixtures.ts';
import type { Page } from '@playwright/test';

export async function playCarrier(page: Page): Promise<void> {
  const log = page.getByRole('log');
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await page.getByLabel('BANDWIDTH').selectOption('5');
  // Reasoning first: a bright fixed line is refused.
  await page.getByLabel('TUNE').fill('100');
  await page.getByRole('button', { name: 'LOCK' }).click();
  await expect(log).toContainText('THAT LINE DOES NOT MOVE');
  await page.getByLabel('TUNE').fill('200');
  await page.getByLabel('DRIFT', { exact: true }).fill('-0.42');
  await page.getByRole('button', { name: 'LOCK' }).click();
  await expect(log).toContainText('CARRIER LOCKED');
  await expect(log).toContainText('I have been listening');
}

test('a new player can finish Episode 000 through the real interface', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('log')).toContainText('SIGNAL RECEIVED');
  await page.keyboard.press('Enter');
  const log = page.getByRole('log');

  // Later tools are not offered yet.
  await expect(page.getByRole('button', { name: /DECODER/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /INQUIRY/ })).toHaveCount(0);

  // --- The Carrier ---
  await playCarrier(page);
  await page.getByRole('button', { name: /TRANSMISSIONS/ }).click();
  await expect(log).toContainText('TX-001');

  // --- The Pattern ---
  await page.getByRole('button', { name: /ARCHIVE/ }).click();
  await page.getByRole('button', { name: /REV C/ }).click();
  await expect(page.getByRole('article', { name: 'Message' })).toContainText('SUPERSEDES');

  await page.getByRole('button', { name: /DECODER/ }).click();
  await page.getByLabel('RASTER WIDTH').fill('7');
  await page.getByLabel('GRID REFERENCE').fill('417');
  await page.getByRole('button', { name: 'SUBMIT' }).click();
  await expect(log).toContainText('THAT WIDTH SHOWS NOTHING');

  await page.getByLabel('RASTER WIDTH').fill('13');
  await expect(page.getByLabel('Rastered bits')).toContainText('#..');
  await page.getByLabel('GRID REFERENCE').fill('7-1-4');
  await page.getByRole('button', { name: 'SUBMIT' }).click();
  await expect(log).toContainText('NO SUCH GRID');

  await page.getByLabel('GRID REFERENCE').fill('4-1-7');
  await page.getByRole('button', { name: 'SUBMIT' }).click();
  await expect(log).toContainText('REFERENCE ACCEPTED');
  await expect(log).toContainText('Four, one, seven');

  // --- The Archive ---
  await page.getByRole('button', { name: /ARCHIVE/ }).click();
  await expect(page.getByRole('button', { name: /STATION LOG/ })).toHaveCount(0);
  await page.getByLabel('SEARCH').fill('417');
  await page.getByRole('button', { name: 'QUERY' }).click();
  await page.getByRole('button', { name: /STATION LOG/ }).click();
  await expect(page.getByRole('article', { name: 'Message' })).toContainText('99306');
  await page.getByRole('button', { name: /UTILITY LEDGER/ }).click();
  await expect(log).toContainText('lost in a storm');

  await page.getByRole('button', { name: /INQUIRY/ }).click();
  await page.getByLabel('FIRST RECEIPT').fill('1999-11-02');
  await page.getByLabel('DISCONNECT ORDERED BY').selectOption('MOYEN');
  await page.getByLabel('RELAY 07 STATUS').selectOption('RUNNING');
  await page.getByRole('button', { name: 'FILE REPORT' }).click();
  await expect(log).toContainText('2 OF 3 FIELDS CONSISTENT');

  await page.getByLabel('DISCONNECT ORDERED BY').selectOption('MOYE');
  await page.getByRole('button', { name: 'FILE REPORT' }).click();

  // --- The ending ---
  const ending = page.locator('.ending').getByRole('log');
  await expect(ending).toContainText('The specification came later', { timeout: 30_000 });
  await expect(ending).toContainText('RELAY 07: RECOVERED', { timeout: 30_000 });
  await expect(ending).toContainText('IT WAS AN INVITATION.', { timeout: 30_000 });
  await expect(ending).toContainText(/OBSERVER DESIGNATION ASSIGNED: OBS-[0-9A-F]{4}/, {
    timeout: 30_000,
  });
  const text = await ending.innerText();
  expect(text.indexOf('The specification came later')).toBeLessThan(text.indexOf('RECOVERED'));

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('OBS>')).toBeVisible();

  // --- Progress survives a reload, without replaying the ending ---
  await page.reload();
  await page.keyboard.press('Enter');
  await expect(page.locator('.ending')).toHaveCount(0);
  await page.getByRole('button', { name: /STATUS/ }).click();
  await expect(page.getByRole('log')).toContainText(/DESIGNATION: OBS-[0-9A-F]{4}/);
  await page.getByRole('button', { name: /INQUIRY/ }).click();
  await expect(page.getByRole('log')).toContainText('ALL FIELDS CONSISTENT');
  expect(errors).toEqual([]);
});
