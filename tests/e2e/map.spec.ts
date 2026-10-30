import { expect, test } from './fixtures.ts';
import { completeEpisode } from './helpers.ts';

test('the map opens after the episode, and rewards exploring it', async ({ page }) => {
  await page.goto('./');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /NETWORK MAP/ })).toHaveCount(0);

  await completeEpisode(page);
  await page.getByRole('button', { name: 'CONTINUE' }).click();
  const log = page.getByRole('log');

  const openMap = () => page.getByRole('button', { name: /NETWORK MAP/ }).click();
  const node = (name: string) => page.getByRole('button', { name, exact: true });
  const press = async (name: string) => {
    await node(name).focus();
    await page.keyboard.press('Enter');
  };

  // The Silent Observatory: an authored dead end.
  await openMap();
  await expect(node('RELAY 07')).toBeVisible();
  await expect(node('THE ARCHIVE')).toBeVisible();
  await press('SILENT OBSERVATORY');
  await expect(log).toContainText('NO CARRIER');
  await expect(log).toContainText('2 OBSERVERS REQUIRED');

  // The Archive: new lore, including the evidence for the discovery.
  await openMap();
  await press('THE ARCHIVE');
  await page.getByRole('button', { name: /LAST ONE OUT/ }).click();
  await expect(page.getByRole('article', { name: 'Message' })).toContainText('leaving the modem');
  await page.getByRole('button', { name: /METER TRACE/ }).click();
  await expect(page.getByRole('article', { name: 'Message' })).toContainText('###  .#.  ###');

  // Relay 07: explorable, and the panel takes the code.
  await openMap();
  await press('RELAY 07');
  await expect(log).toContainText('STILL TRACKING');
  await expect(log).toContainText('first thing to arrive');
  await page.getByLabel('SERVICE CODE').fill('409');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('THE KEYPAD CLICKS');
  await page.getByLabel('SERVICE CODE').fill('7-0-9');
  await page.keyboard.press('Enter');
  await expect(log).toContainText('THE PANEL SWINGS OPEN');

  // It stays that way.
  await page.reload();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /NETWORK MAP/ }).click();
  await page.getByRole('button', { name: 'RELAY 07', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('THE PANEL SWINGS OPEN');
  await expect(page.getByLabel('SERVICE CODE')).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('signal-lost.save'));
  expect(JSON.parse(saved!).locations).toContain('relay-07');
});
