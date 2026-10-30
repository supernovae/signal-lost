import { expect, test } from './fixtures.ts';
import { completeEpisode } from './helpers.ts';

test('FORGE is a secret behind the panel, and leads to the filing office', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Enter');
  await completeEpisode(page);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  const log = page.getByRole('log');
  const forgeTool = page.getByRole('button', { name: /\] FORGE$/ });
  await expect(forgeTool).toHaveCount(0);

  await page.getByRole('button', { name: /NETWORK MAP/ }).click();
  await page.getByRole('button', { name: 'RELAY 07', exact: true }).click();
  await page.getByLabel('SERVICE CODE').fill('709');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('ITS POWER LIGHT COMES ON');

  await forgeTool.click();
  await expect(log).toContainText('THIS NETWORK ACCEPTS NEW TRANSMISSIONS');
  await expect(log).toContainText("It isn't a place in my world");
  const link = page.getByRole('link', { name: 'FILE A TRANSMISSION' });
  await expect(link).toHaveAttribute('href', /propose-transmission\.yml$/);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

  // A record nobody remembers writing, with a name on it.
  await page.getByRole('button', { name: /TRANSMISSIONS/ }).click();
  await expect(log).toContainText('TX-C01  FIRST LIGHT');
  await expect(log).toContainText('FILED BY: SIGNAL//LOST maintainers (supernovae)');
  await page.getByRole('button', { name: /\] ARCHIVE$/ }).click();
  await page.getByRole('button', { name: /IS ANYONE ELSE ON THIS LINE/ }).click();
  await expect(page.getByRole('article', { name: 'Message' })).toContainText('FILED BY');
  await expect(log).toContainText('Nobody I remember wrote it');
});
