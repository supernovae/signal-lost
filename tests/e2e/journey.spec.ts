import { expect, test } from './fixtures.ts';
import { completeEpisode } from './helpers.ts';

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test.describe(`with ${reducedMotion} motion`, () => {
    test.use({ reducedMotion });

    test('a new player goes from the opening to the post-episode map', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto('./');
      await expect(page.locator('body')).toHaveAttribute(
        'data-motion',
        reducedMotion === 'reduce' ? 'off' : 'on',
      );
      await expect(page.getByRole('log')).toContainText('PRESS ENTER TO JOIN THE NETWORK');
      await page.keyboard.press('Enter');

      await completeEpisode(page);
      const ending = page.locator('.ending').getByRole('log');
      await expect(ending).toContainText('IT WAS AN INVITATION.', { timeout: 30_000 });
      await page.getByRole('button', { name: 'CONTINUE' }).click();

      await page.getByRole('button', { name: /NETWORK MAP/ }).click();
      for (const name of ['RELAY 07', 'THE ARCHIVE', 'SILENT OBSERVATORY']) {
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      }
      await page.getByRole('button', { name: 'RELAY 07', exact: true }).click();
      await expect(page.getByRole('log')).toContainText('STILL TRACKING');
      expect(errors).toEqual([]);
    });
  });
}

test('the survey-mark table fits the reading pane at 1280x720', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('./');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /ANALYZER/ }).click();
  await page.getByLabel('BANDWIDTH').selectOption('5');
  await page.getByLabel('TUNE').fill('200');
  await page.getByLabel('DRIFT', { exact: true }).fill('-0.42');
  await page.getByRole('button', { name: 'LOCK' }).click();
  await page.getByRole('button', { name: /\] ARCHIVE$/ }).click();
  await page.getByRole('button', { name: /REV C/ }).click();

  const reader = page.getByRole('article', { name: 'Message' });
  const lastRow = reader.locator('p', { hasText: /^MARK/ }).last();
  const readerBox = (await reader.boundingBox())!;
  const rowBox = (await lastRow.boundingBox())!;
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(readerBox.y + readerBox.height);
});
